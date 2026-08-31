/**
 * Shared helpers for interpreting the admin-tier `Role` values
 * (`"admin" | "editor" | "author"`) that live inside a merged `User`'s
 * generic `roles: string[]` array — dec-identity-unification Phase 5b.
 *
 * There is no closed `Role` union on the merged type itself (Phase 5a
 * collapsed `role: Role` + `roles: string[]` into `roles: string[]` only);
 * these three strings are just conventional values inside that array,
 * interpreted here rather than enforced by the type.
 *
 * `ROLE_RANK`/`highestValidRole()` are thin wrappers over `@dune/core`'s
 * `ADMIN_ROLE_RANK`/`highestAdminRole()` (`@dune/core/auth/authz-schema`),
 * not a second, separately-maintained copy of the same three numbers —
 * exactly the "two tables kept in sync by convention" pattern the
 * `ROLE_PERMISSIONS` removal (3.0.0) eliminated elsewhere. Core owns the
 * canonical ranking; this package consumes it.
 */

import type { Role } from "../types.ts";
import { ADMIN_ROLE_RANK, highestAdminRole } from "@dune/core/auth/authz-schema";

export const VALID_ROLES: ReadonlySet<Role> = new Set<Role>([
  "admin",
  "editor",
  "author",
]);

export const ROLE_RANK: Record<Role, number> = ADMIN_ROLE_RANK;

/** Pick the highest-ranked valid admin `Role` out of a generic roles[] array, or undefined if none present. */
export function highestValidRole(
  roles: string[] | undefined,
): Role | undefined {
  const best = highestAdminRole(roles);
  return best === "" ? undefined : (best as Role);
}

/** Validate a single role string, falling back to `fallback` if it's not a known `Role`. */
export function sanitizeRole(role: string | undefined, fallback: Role): Role {
  if (typeof role !== "string") return fallback;
  if (!VALID_ROLES.has(role as Role)) return fallback;
  return role as Role;
}

/**
 * Replace the admin-tier role in a roles[] array, preserving any non-admin-tier
 * tags already present (e.g. a future public-site membership tag coexisting
 * on the same account). Used when the admin panel changes a user's role.
 */
export function withRole(roles: string[], role: Role): string[] {
  const nonAdminTags = roles.filter((r) => !VALID_ROLES.has(r as Role));
  return [role, ...nonAdminTags];
}
