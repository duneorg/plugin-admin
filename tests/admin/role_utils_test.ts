/**
 * Tests for role-utils.ts's delegation to @dune/core's canonical
 * ADMIN_ROLE_RANK/highestAdminRole() (@dune/core/auth/authz-schema) —
 * ROLE_RANK/highestValidRole() are thin wrappers, not a second
 * hand-maintained copy of the same rank table.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ADMIN_ROLE_RANK } from "@dune/core/auth/authz-schema";
import {
  highestValidRole,
  ROLE_RANK,
  VALID_ROLES,
} from "../../src/admin/auth/role-utils.ts";

Deno.test("ROLE_RANK is @dune/core's ADMIN_ROLE_RANK, not a separate copy", () => {
  assertEquals(ROLE_RANK, ADMIN_ROLE_RANK);
});

Deno.test("highestValidRole: picks the highest admin-tier role regardless of order", () => {
  assertEquals(highestValidRole(["member", "admin"]), "admin");
  assertEquals(highestValidRole(["editor", "admin"]), "admin");
  assertEquals(highestValidRole(["member", "editor", "author"]), "editor");
  assertEquals(highestValidRole(["author"]), "author");
});

Deno.test("highestValidRole: undefined when no admin-tier role is present", () => {
  assertEquals(highestValidRole(["member", "subscriber"]), undefined);
  assertEquals(highestValidRole(undefined), undefined);
  assertEquals(highestValidRole([]), undefined);
});

Deno.test("VALID_ROLES matches the keys of ROLE_RANK", () => {
  assertEquals(
    [...VALID_ROLES].sort(),
    Object.keys(ROLE_RANK).sort(),
  );
});
