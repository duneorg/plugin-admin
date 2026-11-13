/**
 * User management — admin-panel-facing convenience layer over @dune/core's
 * unified UserStore (dec-identity-unification Phase 5b).
 *
 * Delegates all storage to @dune/core's createLocalUserStore, so admin
 * accounts live in the same store/format/directory (data/users/) as public
 * site visitors, and get the same TOCTOU-safe duplicate-email protection
 * (Phase 0) admin accounts never had before this. Adds admin-specific
 * conveniences the generic UserStore has no reason to know about: a single
 * `role: Role` create/update parameter (translated to/from `roles: string[]`
 * via role-utils.ts) and password hashing (via @dune/core/auth/passwords).
 *
 * There is deliberately no default admin: the first admin is created
 * explicitly with `dune users:create --role admin --password-prompt` or from
 * DUNE_ADMIN_EMAIL / DUNE_ADMIN_PASSWORD at boot (both in @dune/core).
 */

import type { PluginServices, StorageAdapter, UserStore } from "@dune/plugin-api";
import type { Role, User } from "../types.ts";
import { withRole } from "./role-utils.ts";

/** Options for {@link createUserManager}. */
export interface UserManagerConfig {
  storage: StorageAdapter;
  /** Directory for user files (e.g. "data/users") */
  usersDir: string;
  /** Core's services: the user store and password hashing. */
  services: Pick<PluginServices, "users" | "passwords">;
}

/** Input for {@link UserManager.create}. */
export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: Role;
  name: string;
}

/** CRUD operations for admin users. Obtain via {@link createUserManager}. */
export interface UserManager {
  /** Create a new user. Returns the user (without password). */
  create(input: CreateUserInput): Promise<User>;
  /** Get a user by ID */
  getById(id: string): Promise<User | null>;
  /** Get a user by username */
  getByUsername(username: string): Promise<User | null>;
  /** List all users */
  list(): Promise<User[]>;
  /** Update a user (partial update) */
  update(
    id: string,
    updates: { email?: string; role?: Role; name?: string; enabled?: boolean },
  ): Promise<User | null>;
  /** Change a user's password */
  changePassword(id: string, newPassword: string): Promise<boolean>;
  /** Delete a user */
  delete(id: string): Promise<boolean>;
}

/**
 * Create a user manager backed by @dune/core's UserStore.
 */
export function createUserManager(config: UserManagerConfig): UserManager {
  const { usersDir, services } = config;
  const store: UserStore = services.users.createLocalStore({ usersDir });
  const hashPassword = services.passwords.hash;

  async function create(input: CreateUserInput): Promise<User> {
    return store.create({
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      provider: "local",
      roles: [input.role],
      name: input.name,
    });
  }

  async function update(
    id: string,
    updates: { email?: string; role?: Role; name?: string; enabled?: boolean },
  ): Promise<User | null> {
    const existing = await store.getById(id);
    if (!existing) return null;

    return store.update(id, {
      email: updates.email,
      name: updates.name,
      enabled: updates.enabled,
      roles: updates.role !== undefined ? withRole(existing.roles, updates.role) : undefined,
    });
  }

  async function changePassword(id: string, newPassword: string): Promise<boolean> {
    const existing = await store.getById(id);
    if (!existing) return false;
    const updated = await store.update(id, { passwordHash: await hashPassword(newPassword) });
    return updated !== null;
  }

  return {
    create,
    getById: store.getById,
    getByUsername: store.getByUsername,
    list: store.list,
    update,
    changePassword,
    delete: store.delete,
  };
}
