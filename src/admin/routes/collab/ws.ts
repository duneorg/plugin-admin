/**
 * GET /admin/collab/ws?docId=... (Upgrade: websocket)
 * Real-time collaborative editing WebSocket endpoint.
 */

import type { AdminState } from "../../types.ts";
import { checkPermission, requireTsxWrite, requireOwnedPage, websocketOriginCheck } from "../api/_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { collab } = ctx.state.adminContext;
    if (!collab) {
      return new Response("Collaboration not enabled", { status: 501 });
    }
    if (ctx.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const originDenied = websocketOriginCheck(ctx);
    if (originDenied) return originDenied;

    const docId = ctx.url.searchParams.get("docId");
    if (!docId) {
      return new Response("Missing docId", { status: 400 });
    }
    const authResult = ctx.state.auth;
    if (!authResult?.authenticated || !authResult.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    // Per-document authorization: bind WebSocket access to the same
    // permission a non-realtime page edit would require.
    if (!await checkPermission(ctx, "pages.update")) {
      return new Response("Forbidden", { status: 403 });
    }
    const tsxDenied = requireTsxWrite(ctx, docId);
    if (tsxDenied) return tsxDenied;
    const ownerDenied = await requireOwnedPage(ctx, docId);
    if (ownerDenied) return ownerDenied;
    return collab.handleUpgrade(ctx.req, authResult.user);
  },
};
