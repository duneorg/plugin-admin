/** GET /admin/submissions/:form/:id/files/:filename */

import type { AdminState } from "../../../../../types.ts";
import type { FreshContext } from "fresh";
import { requirePermission } from "../../../../api/_utils.ts";
import { getMimeType } from "@dune/core/content/page-loader";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function safeSegment(s: string): boolean {
  if (!s || s === "." || s === "..") return false;
  if (s.includes("\0") || s.includes("/") || s.includes("\\")) return false;
  return SAFE_SEGMENT_RE.test(s);
}

// MIME types that are safe to serve inline in a browser context.
// Everything else is forced to application/octet-stream (download) to prevent
// a tampered submission JSON from causing the browser to render
// attacker-controlled content (e.g. text/html) in the admin panel origin.
const SAFE_INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, storage } = ctx.state.adminContext;
    if (!submissions) {
      return new Response("Submissions not enabled", { status: 501 });
    }

    const form = decodeURIComponent(ctx.params.form);
    const id = decodeURIComponent(ctx.params.id);
    const filename = decodeURIComponent(ctx.params.filename);

    if (!safeSegment(form) || !safeSegment(id) || !safeSegment(filename)) {
      return new Response("Invalid path", { status: 400 });
    }

    const sub = await submissions.get(form, id);
    if (!sub) {
      return new Response("Not found", { status: 404 });
    }

    const fileMeta = sub.files?.find((f) => f.name === filename);
    if (!fileMeta) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const data = await storage.read(fileMeta.storagePath);

      // Re-derive the MIME type from the filename at serve time rather than
      // trusting the stored fileMeta.contentType. A tampered submission JSON
      // (reachable via a path traversal or direct data directory access) could
      // set contentType to text/html, causing the browser to render
      // attacker-controlled content in the admin panel origin.
      const derivedType = getMimeType(filename);
      const contentType = derivedType !== undefined && SAFE_INLINE_TYPES.has(derivedType)
        ? derivedType
        : "application/octet-stream";

      const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      return new Response(data.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "Content-Length": String(data.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
    }
  },
};
