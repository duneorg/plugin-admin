/**
 * Tests for the shared HTTP response helpers, specifically the distinction
 * between serverError() (admin, authenticated) and publicServerError()
 * (public, unauthenticated) — the latter must never leak an error's own
 * message or map it to anything other than a fixed 500.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  NotFoundError,
  publicServerError,
  serverError,
  ValidationError,
} from "../../src/admin/http.ts";

Deno.test("serverError: ValidationError includes its own message (admin, authenticated)", async () => {
  const res = serverError(new ValidationError("field 'x' is required"));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "field 'x' is required");
});

Deno.test("serverError: NotFoundError includes its own message (admin, authenticated)", async () => {
  const res = serverError(new NotFoundError("page 'x' not found"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "page 'x' not found");
});

Deno.test("publicServerError: ValidationError message is NOT leaked", async () => {
  const res = publicServerError(new ValidationError("internal-detail-leak"));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
  assertEquals(JSON.stringify(body).includes("internal-detail-leak"), false);
});

Deno.test("publicServerError: NotFoundError message is NOT leaked", async () => {
  const res = publicServerError(new NotFoundError("internal-detail-leak"));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
});

Deno.test("publicServerError: a plain Error's message is NOT leaked", async () => {
  const res = publicServerError(new Error("stack-trace-adjacent-detail"));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
  assertEquals(JSON.stringify(body).includes("stack-trace-adjacent-detail"), false);
});
