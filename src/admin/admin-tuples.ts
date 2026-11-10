/**
 * Which accounts the admin gives direct editing rights.
 *
 * `admin`, `editor` and `author` in a user's `roles[]` already carry editing
 * rights through core's group grants (`system.role_grants`), for any signed-in
 * user. What the admin adds is a direct tuple for **its own accounts**, so they
 * can use the panel even when a site turns the group grants off with
 * `role_grants: {}`. Its own accounts are the ones that can sign in to it: the
 * built-in sign-in is by password, so those with a local password.
 *
 * A site user (OAuth, magic link, `external-jwt`) who happens to hold an
 * admin-tier role gets no direct tuple here: they are governed by
 * `role_grants` like everyone else, and a direct tuple would keep them editing
 * after the site switched that off.
 *
 * @module
 */

import { highestValidRole } from "./auth/role-utils.ts";

/** The part of a user record this needs. */
export interface StoredAccount {
  id: string;
  roles: string[];
  enabled?: boolean;
  provider?: string;
  passwordHash?: string;
}

/** The part of core's authz this needs. */
export interface TupleAuthz {
  seedAdminTuples(users: Array<{ id: string; role: string }>): Promise<void>;
  revoke(userId: string, relation: string): Promise<void>;
}

/** An account that can sign in to the built-in admin: it has a local password. */
export function isAdminAccount(user: StoredAccount): boolean {
  return user.provider === "local" || !!user.passwordHash;
}

/**
 * Seed the direct tuple of every enabled admin account that holds an
 * admin-tier role, and revoke the one an earlier version seeded for an
 * account that cannot sign in to the admin. Returns how many it revoked.
 */
export async function reconcileAdminTuples(users: StoredAccount[], authz: TupleAuthz): Promise<number> {
  const seed: Array<{ id: string; role: string }> = [];
  const stale: Array<{ id: string; role: string }> = [];
  for (const user of users) {
    const role = highestValidRole(user.roles);
    if (role === undefined) continue;
    if (isAdminAccount(user)) {
      if (user.enabled !== false) seed.push({ id: user.id, role });
    } else {
      stale.push({ id: user.id, role });
    }
  }
  await authz.seedAdminTuples(seed);
  for (const { id, role } of stale) await authz.revoke(id, role);
  return stale.length;
}
