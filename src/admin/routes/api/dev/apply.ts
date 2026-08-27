/**
 * POST /admin/api/dev/apply
 *
 * Agent-facing change API — applies batched, validated content and config
 * mutations in a single request. Supports dry-run mode for preview.
 *
 * ⚠️  Dev-mode only. Disabled when DUNE_ENV=production or system.debug=false
 *    in a production-like environment. Protects against accidental exposure
 *    of file-write capabilities in deployed sites.
 *
 * Requires: pages.update for the route and for content ops. `config` and
 * `plugin.install` also need config.update — the same split as the
 * production routes — so turning debug on in a public site does not
 * promote an author/editor to admin.
 *
 * Request body:
 * {
 *   "dry_run": true,              // optional; default false
 *   "changes": [
 *     { "op": "write",            "path": "content/blog/post.md", "content": "---\ntitle: X\n---" },
 *     { "op": "delete",           "path": "content/blog/old.md" },
 *     { "op": "frontmatter",      "path": "content/blog/post.md", "patch": { "title": "New" } },
 *     { "op": "config",           "key": "admin.path", "value": "/cms" },
 *     { "op": "plugin.install",   "spec": "jsr:@dune/blog@1.0.0" }
 *   ]
 * }
 *
 * Response:
 * {
 *   "dry_run": true,
 *   "results": [
 *     { "op": "write", "path": "...", "status": "would_create", "errors": [] },
 *     { "op": "config", "key": "admin.path", "status": "would_update", "errors": [] },
 *     { "op": "plugin.install", "spec": "...", "status": "would_create", "errors": [] }
 *   ],
 *   "summary": { "total": 3, "valid": 3, "errors": 0 }
 * }
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../../../types.ts";
import { json, requirePermission, requireTsxWrite, requireOwnedPage, csrfCheck, validatePagePath } from "../_utils.ts";
import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

// Maximum content size: 2 MB
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
// Maximum changes per request
const MAX_CHANGES = 50;

// Allowed operations
type Op = "write" | "delete" | "frontmatter" | "config" | "plugin.install";

interface Change {
  op: Op;
  /** For content ops (write, delete, frontmatter) — relative path within content dir */
  path?: string;
  /** For op="write" — full file content */
  content?: string;
  /** For op="frontmatter" — frontmatter keys to update (merged, not replaced) */
  patch?: Record<string, unknown>;
  /** For op="config" — dot-notation config key, e.g. "admin.path" */
  key?: string;
  /** For op="config" — new value for the key */
  value?: unknown;
  /** For op="plugin.install" — plugin specifier, e.g. "jsr:@dune/blog@1.0.0" */
  spec?: string;
}

type ChangeStatus =
  | "would_create"
  | "would_update"
  | "would_delete"
  | "would_skip"
  | "created"
  | "updated"
  | "deleted"
  | "skipped"
  | "error";

interface ChangeResult {
  op: Op;
  path?: string;
  key?: string;
  spec?: string;
  status: ChangeStatus;
  errors: string[];
}

// Only allow pinned jsr: specifiers for plugin.install — same constraint as
// POST /admin/api/plugins/install. npm: and https: are rejected: npm: without
// a version allows arbitrary version resolution on next restart, and https:
// with no domain allowlist is a direct supply-chain RCE vector (arbitrary URL
// → executed as Deno module on restart).
const PLUGIN_SPEC_RE =
  /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;

/** Set a nested value on obj using dot-notation key. Mutates in place. */
function setDeepKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Determine if we're in dev mode. */
function isDevMode(ctx: FreshContext<AdminState>): boolean {
  const { config } = ctx.state.adminContext;
  if (Deno.env.get("DUNE_ENV") === "dev") return true;
  if (config.system.debug === true) return true;
  return false;
}

/**
 * Config keys that dev/apply's `config` op must never set. Setting
 * `system.debug` from within the endpoint itself would let a user holding
 * pages.update + config.update re-enable this very endpoint (and other
 * debug-only surfaces) in a production-like environment — the gate in
 * isDevMode() is meant to be an operator decision, not a self-service one.
 * Incoming-webhook tokens and auth provider settings are similarly
 * security-sensitive and out of scope for the agent change API.
 */
const BLOCKED_CONFIG_KEYS: readonly string[] = [
  "system.debug",
  "system.trusted_proxies",
  "admin.incoming_webhooks",
];

function isBlockedConfigKey(key: string): boolean {
  const lower = key.toLowerCase();
  return BLOCKED_CONFIG_KEYS.some((blocked) => lower === blocked) ||
    lower.startsWith("admin.incoming_webhooks.");
}

/**
 * Sanitize an operation error for the response body. Internal error strings
 * can contain filesystem paths and config details; the full error is logged
 * server-side while the client only sees the error class.
 */
function safeOpError(err: unknown): string {
  console.error("[dev/apply] change failed:", err);
  return err instanceof Error ? `operation failed (${err.name})` : "operation failed";
}

/** Validate a change and return any errors. */
function validateChange(change: Change): string[] {
  const errors: string[] = [];
  const VALID_OPS = ["write", "delete", "frontmatter", "config", "plugin.install"];

  if (!change.op) errors.push("op is required");
  if (!VALID_OPS.includes(change.op)) {
    errors.push(`op must be one of: ${VALID_OPS.join(", ")} (got "${change.op}")`);
    return errors; // can't validate further without a valid op
  }

  // Content ops require a valid path
  if (["write", "delete", "frontmatter"].includes(change.op)) {
    if (!change.path) {
      errors.push("path is required");
    } else if (!validatePagePath(change.path)) {
      errors.push(`path "${change.path}" is invalid or attempts path traversal`);
    } else {
      const allowed = /\.(md|mdx|tsx|yaml|yml|json|txt)$/i;
      if (!allowed.test(change.path)) {
        errors.push(`path must end in .md, .mdx, .tsx, .yaml, .yml, .json, or .txt`);
      }
    }
  }

  if (change.op === "write") {
    if (typeof change.content !== "string") {
      errors.push("content (string) is required for op=write");
    } else if (new TextEncoder().encode(change.content).length > MAX_CONTENT_BYTES) {
      errors.push(`content exceeds ${MAX_CONTENT_BYTES / 1024}KB limit`);
    } else if (change.path?.match(/\.(md|mdx)$/i) && change.content.startsWith("---")) {
      const end = change.content.indexOf("---", 3);
      if (end === -1) {
        errors.push("Unclosed YAML frontmatter (missing closing '---')");
      } else {
        try {
          parseYaml(change.content.slice(3, end).trim());
        } catch (err) {
          errors.push(`Invalid YAML frontmatter: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  if (change.op === "frontmatter") {
    if (!change.patch || typeof change.patch !== "object" || Array.isArray(change.patch)) {
      errors.push("patch (object) is required for op=frontmatter");
    }
  }

  if (change.op === "config") {
    if (typeof change.key !== "string" || !change.key.trim()) {
      errors.push("key (string) is required for op=config");
    } else if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(change.key)) {
      errors.push(`key "${change.key}" must be a dot-notation identifier (e.g. "admin.path")`);
    } else if (isBlockedConfigKey(change.key)) {
      errors.push(
        `key "${change.key}" cannot be changed via dev/apply (security-sensitive setting)`,
      );
    }
    if (change.value === undefined) {
      errors.push("value is required for op=config");
    }
  }

  if (change.op === "plugin.install") {
    if (typeof change.spec !== "string" || !change.spec.trim()) {
      errors.push("spec (string) is required for op=plugin.install");
    } else if (!PLUGIN_SPEC_RE.test(change.spec)) {
      errors.push(`spec "${change.spec}" must be a pinned jsr: specifier (e.g. jsr:@scope/name@1.2.3)`);
    }
  }

  return errors;
}

/** Apply a single write or frontmatter-patch change. */
async function applyWrite(
  contentDir: string,
  change: Change & { op: "write" | "frontmatter"; path: string },
): Promise<void> {
  const absPath = join(contentDir, change.path);
  const absDir = absPath.substring(0, absPath.lastIndexOf("/"));

  if (change.op === "write") {
    await Deno.mkdir(absDir, { recursive: true });
    await Deno.writeTextFile(absPath, change.content!);
    return;
  }

  // op = frontmatter: read existing file, patch frontmatter, write back
  let existing = "";
  try {
    existing = await Deno.readTextFile(absPath);
  } catch {
    // File doesn't exist — create minimal markdown with just the frontmatter patch
    const fm = stringifyYaml(change.patch!).trim();
    await Deno.mkdir(absDir, { recursive: true });
    await Deno.writeTextFile(absPath, `---\n${fm}\n---\n`);
    return;
  }

  // Parse existing frontmatter
  if (existing.startsWith("---")) {
    const end = existing.indexOf("---", 3);
    if (end !== -1) {
      const fmText = existing.slice(3, end).trim();
      const body = existing.slice(end + 3);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (parseYaml(fmText) as Record<string, unknown>) ?? {};
      } catch {
        parsed = {};
      }
      const merged = { ...parsed, ...change.patch! };
      const newFm = stringifyYaml(merged).trim();
      await Deno.writeTextFile(absPath, `---\n${newFm}\n---${body}`);
      return;
    }
  }

  // No frontmatter — prepend it
  const fm = stringifyYaml(change.patch!).trim();
  await Deno.writeTextFile(absPath, `---\n${fm}\n---\n\n${existing}`);
}

/** Apply a config key change to config/site.yaml. Returns whether a change was made. */
async function applyConfig(
  siteRoot: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const configPath = join(siteRoot, "config", "site.yaml");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await Deno.readTextFile(configPath);
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // Config file absent — will be created
  }

  setDeepKey(existing, key, value);
  await Deno.mkdir(join(siteRoot, "config"), { recursive: true });
  await Deno.writeTextFile(configPath, stringifyYaml(existing));
  return true;
}

/** Add a plugin spec to config/site.yaml plugins list. Returns false if already present. */
async function applyPluginInstall(
  siteRoot: string,
  spec: string,
): Promise<boolean> {
  const configPath = join(siteRoot, "config", "site.yaml");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await Deno.readTextFile(configPath);
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // Config absent — will be created
  }

  const plugins = Array.isArray(existing.plugins) ? existing.plugins as string[] : [];
  if (plugins.includes(spec)) return false; // already installed

  existing.plugins = [...plugins, spec];
  await Deno.mkdir(join(siteRoot, "config"), { recursive: true });
  await Deno.writeTextFile(configPath, stringifyYaml(existing));
  return true;
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    // CSRF check
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;

    // Dev-mode gate — refuse in production
    if (!isDevMode(ctx)) {
      return json({
        error: "dev/apply is only available in dev mode. Set DUNE_ENV=dev or system.debug: true.",
      }, 403);
    }

    // Permission check
    const denied = await requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { config } = ctx.state.adminContext;
    const siteRoot = Deno.cwd();
    const contentDir = join(
      config.system.content.dir.startsWith("/")
        ? config.system.content.dir
        : join(siteRoot, config.system.content.dir),
    );

    // Parse request body
    let body: { dry_run?: boolean; changes?: unknown[] };
    try {
      body = await ctx.req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const dryRun = body.dry_run === true;
    const rawChanges = Array.isArray(body.changes) ? body.changes : [];

    if (rawChanges.length === 0) {
      return json({ error: "changes array is required and must not be empty" }, 400);
    }
    if (rawChanges.length > MAX_CHANGES) {
      return json({ error: `Too many changes: ${rawChanges.length} (max ${MAX_CHANGES})` }, 400);
    }

    const results: ChangeResult[] = [];

    for (const raw of rawChanges) {
      const change = raw as Change;
      const errors = validateChange(change);

      if (errors.length > 0) {
        results.push({ op: change.op, path: change.path, key: change.key, spec: change.spec, status: "error", errors });
        continue;
      }

      if (change.op === "config" || change.op === "plugin.install") {
        const configDenied = await requirePermission(ctx, "config.update");
        if (configDenied) {
          results.push({
            op: change.op,
            key: change.key,
            spec: change.spec,
            status: "error",
            errors: ["config and plugin changes require config.update"],
          });
          continue;
        }
      }

      if (
        change.path &&
        ["write", "delete", "frontmatter"].includes(change.op)
      ) {
        const tsxDenied = requireTsxWrite(ctx, change.path);
        if (tsxDenied) {
          results.push({
            op: change.op,
            path: change.path,
            status: "error",
            errors: ["TSX format requires admin role"],
          });
          continue;
        }
        const known = ctx.state.adminContext.engine?.pages?.some(
          (p) => p.sourcePath === change.path,
        ) ?? false;
        if (known) {
          const ownerDenied = await requireOwnedPage(ctx, change.path);
          if (ownerDenied) {
            results.push({
              op: change.op,
              path: change.path,
              status: "error",
              errors: ["Forbidden"],
            });
            continue;
          }
        }
      }

      // ── config op ──────────────────────────────────────────────────────────
      if (change.op === "config") {
        if (dryRun) {
          results.push({ op: change.op, key: change.key, status: "would_update", errors: [] });
          continue;
        }
        try {
          await applyConfig(siteRoot, change.key!, change.value);
          results.push({ op: change.op, key: change.key, status: "updated", errors: [] });
        } catch (err) {
          results.push({ op: change.op, key: change.key, status: "error", errors: [safeOpError(err)] });
        }
        continue;
      }

      // ── plugin.install op ──────────────────────────────────────────────────
      if (change.op === "plugin.install") {
        if (dryRun) {
          results.push({ op: change.op, spec: change.spec, status: "would_create", errors: [] });
          continue;
        }
        try {
          const added = await applyPluginInstall(siteRoot, change.spec!);
          results.push({ op: change.op, spec: change.spec, status: added ? "created" : "skipped", errors: [] });
        } catch (err) {
          results.push({ op: change.op, spec: change.spec, status: "error", errors: [safeOpError(err)] });
        }
        continue;
      }

      // ── content ops (write / delete / frontmatter) ────────────────────────
      const absPath = join(contentDir, change.path ?? "");

      if (dryRun) {
        let status: ChangeStatus;
        if (change.op === "delete") {
          status = "would_delete";
        } else {
          try {
            await Deno.stat(absPath);
            status = "would_update";
          } catch {
            status = "would_create";
          }
        }
        results.push({ op: change.op, path: change.path, status, errors: [] });
        continue;
      }

      try {
        if (change.op === "delete") {
          await Deno.remove(absPath);
          results.push({ op: change.op, path: change.path, status: "deleted", errors: [] });
        } else {
          const existed = await Deno.stat(absPath).then(() => true).catch(() => false);
          await applyWrite(contentDir, change as Change & { op: "write" | "frontmatter"; path: string });
          results.push({
            op: change.op,
            path: change.path,
            status: existed ? "updated" : "created",
            errors: [],
          });
        }
      } catch (err) {
        results.push({
          op: change.op,
          path: change.path,
          status: "error",
          errors: [safeOpError(err)],
        });
      }
    }

    const errorCount = results.filter((r) => r.status === "error").length;
    const validCount = results.length - errorCount;

    return json({
      dry_run: dryRun,
      results,
      summary: {
        total: results.length,
        valid: validCount,
        errors: errorCount,
      },
    });
  },
};
