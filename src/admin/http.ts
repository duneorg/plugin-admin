/**
 * Shared HTTP response helpers for admin API surfaces.
 *
 * Single home for the JSON responder, typed error classes, and the
 * error-to-Response mapper so the admin API and public API evolve their
 * error-handling policy in lockstep (Q-5, Aug 2026 quality audit).
 * routes/api/_utils.ts re-exports these for existing route imports.
 */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Typed errors that route handlers can throw to map onto specific
 * status codes. Anything else is logged and returned as a generic 500 with
 * no internal details, so internal stack-trace-adjacent strings can't leak
 * to callers (they're still useful, but admins shouldn't be able to read
 * e.g. database errors verbatim).
 */
export class ValidationError extends Error {
  override name = "ValidationError";
}
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
export class PermissionError extends Error {
  override name = "PermissionError";
}

export function serverError(err: unknown): Response {
  console.error("[admin api]", err);

  if (err instanceof ValidationError) {
    return json({ error: err.message || "Bad request" }, 400);
  }
  if (err instanceof NotFoundError) {
    return json({ error: err.message || "Not found" }, 404);
  }
  if (err instanceof PermissionError) {
    return json({ error: "Forbidden" }, 403);
  }
  // Map Deno's filesystem permission errors to 403 — this restores the
  // mapping the old server.ts had (lost in the Fresh 2 rewrite).
  if (err instanceof Deno.errors.PermissionDenied) {
    return json({ error: "Forbidden" }, 403);
  }
  if (err instanceof Deno.errors.NotFound) {
    return json({ error: "Not found" }, 404);
  }

  // Generic — never leak err.message to the client.
  return json({ error: "Internal server error" }, 500);
}

/**
 * Error-to-Response mapper for the public, unauthenticated API surface.
 *
 * {@link serverError} maps `ValidationError`/`NotFoundError` to 400/404 and
 * includes the error's own message — safe for the admin API, where every
 * caller is already authenticated, but not for public-api.ts: an anonymous
 * caller could trigger a `ValidationError` and read back whatever string an
 * internal validation path happened to construct. This mapper always
 * returns a single, fixed error status/message regardless of the thrown
 * error's type or content, matching the public API's original posture.
 */
export function publicServerError(err: unknown): Response {
  console.error("[dune public-api]", err);
  return json({ error: "Internal server error" }, 500);
}
