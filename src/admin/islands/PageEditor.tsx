/** @jsxImportSource preact */
/**
 * Island: full-page editor with frontmatter sidebar, content area, and live preview.
 * Fetches page data from /admin/api/pages/:path and saves back via PUT.
 */

import { useState, useEffect, useRef } from "preact/hooks";

interface BpField {
  type: string;
  label: string;
  default?: unknown;
  required?: boolean;
  options?: Record<string, string>;
  validate?: { min?: number; max?: number; pattern?: string };
}

interface PageData {
  route: string;
  title: string;
  format: string;
  template: string;
  published: boolean;
  rawContent: string | null;
  frontmatter: Record<string, unknown>;
  language?: string;
  translations?: Array<{ lang: string; sourcePath: string; exists: boolean }>;
  blueprint?: { title: string; fields: Record<string, BpField> } | null;
  revisionCount?: number;
}

interface Props {
  pagePath: string;
  pageIndex: unknown;
  prefix: string;
  /** Rendered inside @dune/plugin-inline-edit's on-page overlay iframe — hide chrome that's redundant there (see _layout.tsx's `?embedded=1` handling). */
  embedded?: boolean;
}

/** Frontmatter keys the sidebar always renders its own dedicated control for. */
const HARDCODED_FIELD_KEYS = ["title", "template", "slug", "published", "date", "createdBy"];

/**
 * Keys present in `fm` that have no editable control anywhere in the sidebar
 * — neither the hardcoded fields above nor a blueprint-declared field. These
 * are the ones a one-off `content` file edit is currently the only way to
 * change; the raw-frontmatter view exists mainly to surface them.
 */
export function unmanagedFrontmatterKeys(
  fm: Record<string, unknown>,
  blueprintFields?: Record<string, BpField>,
): string[] {
  const known = new Set([...HARDCODED_FIELD_KEYS, ...Object.keys(blueprintFields ?? {})]);
  return Object.keys(fm).filter((k) => !known.has(k));
}

function formatYamlScalar(value: unknown): string {
  if (typeof value !== "string") return String(value);
  // Not a full YAML-scalar-safety check — this view is read-only display
  // only, never parsed back, so it just needs to avoid obviously misleading
  // unquoted output (empty string, leading/trailing whitespace, or text that
  // looks like YAML punctuation).
  if (value === "" || /^\s|\s$|[:#\[\]{}]|^[-?]/.test(value)) return JSON.stringify(value);
  return value;
}

function formatYamlEntry(key: string, value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}${key}: null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []`;
    return `${pad}${key}:\n${value.map((v) => `${pad}  - ${formatYamlScalar(v)}`).join("\n")}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}${key}: {}`;
    return `${pad}${key}:\n${entries.map(([k, v]) => formatYamlEntry(k, v, indent + 1)).join("\n")}`;
  }
  return `${pad}${key}: ${formatYamlScalar(value)}`;
}

/**
 * Read-only, YAML-ish rendering of the full frontmatter object for the
 * sidebar's "Raw frontmatter" view. Derived from the same `fm` state the
 * structured fields read/write, so it can never diverge from them — it's
 * always exactly what a save would currently write, never a separate
 * editable buffer that could race with it.
 */
export function formatRawFrontmatter(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return "";
  return keys.map((k) => formatYamlEntry(k, fm[k], 0)).join("\n");
}

/**
 * The REST endpoint (/admin/api/pages/:path*) is a wildcard route — a
 * literal "/" is what it matches between segments. encodeURIComponent()
 * on the whole sourcePath turns "/" into "%2F", which the router can't
 * match against a wildcard segment boundary (404s/400s for every nested
 * page, i.e. almost all real content). Encode per-segment instead.
 */
function pagePathUrlSegment(pagePath: string): string {
  return pagePath.split("/").map(encodeURIComponent).join("/");
}

export default function PageEditor({ pagePath, prefix, embedded = false }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageData | null>(null);
  const [rawContent, setRawContent] = useState("");
  const [fm, setFm] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch(`${apiBase}/pages/${pagePathUrlSegment(pagePath)}`)
      .then((r) => r.json())
      .then((data: PageData) => {
        setPage(data);
        setRawContent(data.rawContent ?? "");
        setFm(data.frontmatter ?? {});
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [pagePath]);

  // Warn on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    globalThis.addEventListener("beforeunload", handler);
    return () => globalThis.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save() {
    if (!page) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/pages/${pagePathUrlSegment(pagePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          content: rawContent,
          frontmatter: { ...fm, title: fm.title ?? page.title },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setDirty(false);
      refreshPreview();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function refreshPreview() {
    if (previewRef.current) {
      const src = previewRef.current.src;
      previewRef.current.src = "";
      requestAnimationFrame(() => {
        if (previewRef.current) previewRef.current.src = src;
      });
    }
  }

  function setFmField(key: string, value: unknown) {
    setFm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  if (loading) {
    return <div class="s-7f1b1911">Loading editor…</div>;
  }
  if (!page) {
    return <div class="s-d36754cf">{error || "Page not found."}</div>;
  }

  const unmanagedKeys = unmanagedFrontmatterKeys(fm, page.blueprint?.fields);

  return (
    <div class="editor-layout">
      {/* Top toolbar */}
      <header class="editor-toolbar">
        <div class="toolbar-left">
          {!embedded && <a href={`${prefix}/pages`} class="btn btn-sm btn-outline">← Pages</a>}
          <span class="editor-title">{String(fm.title ?? page.title)}</span>
          <span class={`badge badge-${page.format}`}>{page.format}</span>
          {page.format === "tsx" && (
            <span class="badge badge-warning s-89c10cfd" title="TSX pages execute server-side Deno code. Only trusted admin-role authors should edit these files.">
              ⚠ trusted author only
            </span>
          )}
        </div>
        <div class="toolbar-right">
          <button type="button" class="btn btn-sm btn-outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <a
            href={`${prefix}/pages/builder?path=${encodeURIComponent(pagePath)}`}
            // /pages/builder isn't in _middleware.ts's FRAMEABLE_PATHS — inside
            // the embedded overlay this iframe already IS framed, so a
            // same-frame navigation there would be blocked by its response's
            // own frame-ancestors. Open a real tab instead of a dead click.
            target={embedded ? "_blank" : undefined}
            class="btn btn-sm btn-outline"
          >
            Builder
          </a>
          <a href={page.route} target="_blank" class="btn btn-sm btn-outline">View →</a>
          <a
            href={`${prefix}/pages/history?path=${encodeURIComponent(pagePath)}`}
            target={embedded ? "_blank" : undefined}
            class="btn btn-sm btn-outline"
          >
            History{page.revisionCount ? ` (${page.revisionCount})` : ""}
          </a>
          {dirty && <span class="toolbar-dirty">Unsaved</span>}
          <button type="button" class="btn btn-sm btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div class="editor-body">
        {/* Frontmatter sidebar */}
        <aside class="editor-sidebar">
          <h4>Page Settings</h4>
          <div class="form-group">
            <label>Title</label>
            <input
              type="text"
              value={String(fm.title ?? "")}
              onInput={(e) => setFmField("title", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>Template</label>
            <input
              type="text"
              value={String(fm.template ?? page.template ?? "default")}
              onInput={(e) => setFmField("template", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>Slug</label>
            <input
              type="text"
              value={String(fm.slug ?? "")}
              placeholder="auto"
              onInput={(e) => setFmField("slug", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>
              <input
                type="checkbox"
                checked={!!fm.published}
                onChange={(e) => setFmField("published", (e.target as HTMLInputElement).checked)}
              />{" "}
              Published
            </label>
          </div>
          <div class="form-group">
            <label>Date</label>
            <input
              type="date"
              value={String(fm.date ?? "")}
              onInput={(e) => setFmField("date", (e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Blueprint extra fields */}
          {page.blueprint && Object.entries(page.blueprint.fields).map(([key, field]) => (
            <div class="form-group" key={key}>
              <label>{field.label}</label>
              {field.type === "text" || field.type === "string" ? (
                <input
                  type="text"
                  value={String(fm[key] ?? field.default ?? "")}
                  onInput={(e) => setFmField(key, (e.target as HTMLInputElement).value)}
                />
              ) : field.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={String(fm[key] ?? field.default ?? "")}
                  onInput={(e) => setFmField(key, (e.target as HTMLTextAreaElement).value)}
                />
              ) : field.type === "number" ? (
                // Stored as a real number (not a string) — blueprint
                // validation (validateFrontmatter) requires typeof "number"
                // for this field type, and an empty input clears the key
                // entirely rather than writing NaN/"" into frontmatter, so
                // an optional numeric override round-trips as "absent",
                // not as a stray empty string.
                <input
                  type="number"
                  step="any"
                  min={field.validate?.min}
                  max={field.validate?.max}
                  value={typeof fm[key] === "number" ? String(fm[key]) : ""}
                  placeholder={field.default != null ? String(field.default) : undefined}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    // null (not undefined) — JSON.stringify drops undefined-
                    // valued keys entirely, so the server would never see a
                    // "clear this field" instruction and would keep the old
                    // saved value after a reload. save()'s PUT handler
                    // treats an explicit null as "delete this key".
                    setFmField(key, raw === "" ? null : Number(raw));
                  }}
                />
              ) : field.type === "toggle" || field.type === "checkbox" || field.type === "bool" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(fm[key] ?? field.default)}
                    onChange={(e) => setFmField(key, (e.target as HTMLInputElement).checked)}
                  />
                </label>
              ) : field.type === "select" && field.options ? (
                <select
                  value={String(fm[key] ?? field.default ?? "")}
                  onChange={(e) => setFmField(key, (e.target as HTMLSelectElement).value)}
                >
                  {Object.entries(field.options).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}

          {/* Raw frontmatter — visibility for any key with no dedicated
              control above (not hardcoded, not blueprint-declared). Always
              derived live from `fm`, so it reflects structured-field edits
              instantly and can't drift out of sync with them. Read-only by
              design: editing arbitrary keys here would bypass blueprint
              validation and risk clobbering keys the structured fields are
              also writing to `fm` — declare a blueprint field instead for
              anything that needs to be truly editable. */}
          <div class="form-group">
            <details class="raw-frontmatter">
              <summary>
                Raw frontmatter
                {unmanagedKeys.length > 0 && (
                  <span class="badge badge-warning">{unmanagedKeys.length} unmanaged</span>
                )}
              </summary>
              <textarea
                class="raw-frontmatter-view"
                readOnly
                rows={Math.min(20, Math.max(4, Object.keys(fm).length + 1))}
                value={formatRawFrontmatter(fm)}
              />
              {unmanagedKeys.length > 0 && (
                <p class="raw-frontmatter-hint">
                  {unmanagedKeys.join(", ")} {unmanagedKeys.length === 1 ? "has" : "have"}{" "}
                  no field above — declare {unmanagedKeys.length === 1 ? "it" : "them"} as a blueprint field to edit
                  from this sidebar.
                </p>
              )}
            </details>
          </div>

          {/* Translations */}
          {page.translations && page.translations.length > 0 && (
            <div class="form-group">
              <label>Translations</label>
              <div class="translation-links">
                {page.translations.map((t) => (
                  <div key={t.lang} class="translation-item">
                    <span class="badge badge-lang">{t.lang}</span>
                    {t.exists ? (
                      <a
                        href={`${prefix}/pages/edit?path=${encodeURIComponent(t.sourcePath)}${
                          embedded ? "&embedded=1" : ""
                        }`}
                        class="btn btn-xs btn-outline"
                      >
                        Edit
                      </a>
                    ) : (
                      <button type="button"
                        class="btn btn-xs btn-outline"
                        onClick={() => createTranslation(t.lang)}
                      >
                        Create
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Content area */}
        <main class={`editor-main${showPreview ? " editor-main-split" : ""}`}>
          <textarea
            class="editor-content s-724242e3"
            value={rawContent}
            onInput={(e) => {
              setRawContent((e.target as HTMLTextAreaElement).value);
              setDirty(true);
            }}
            spellcheck={false}
          />
        </main>

        {/* Preview panel */}
        {showPreview && (
          <aside class="editor-preview">
            <iframe
              ref={previewRef}
              src={`${prefix}/api/preview?path=${encodeURIComponent(pagePath)}`}
              class="s-5050775b"
              title="Page preview"
            />
          </aside>
        )}
      </div>

      {error && (
        <div class="toast toast-error s-773881f7">
          {error}
        </div>
      )}
    </div>
  );

  async function createTranslation(lang: string) {
    const res = await fetch(`${apiBase}/pages/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ path: pagePath, targetLang: lang }),
    });
    if (res.ok) {
      const { path: newPath } = await res.json() as { path: string };
      location.href = `${prefix}/pages/edit?path=${encodeURIComponent(newPath)}${
        embedded ? "&embedded=1" : ""
      }`;
    }
  }
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
