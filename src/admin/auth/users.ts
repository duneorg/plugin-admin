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
 * via role-utils.ts), password hashing, and `ensureDefaultAdmin()`.
 */

import type { StorageAdapter } from "@dune/core/storage";
import { createLocalUserStore } from "@dune/core/auth/user-store";
import type { UserStore } from "@dune/core/auth/user-store";
import type { User, Role } from "../types.ts";
import { hashPassword } from "./passwords.ts";
import { withRole } from "./role-utils.ts";

/** Options for {@link createUserManager}. */
export interface UserManagerConfig {
  storage: StorageAdapter;
  /** Directory for user files (e.g. "data/users") */
  usersDir: string;
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
  /**
   * Ensure a default admin user exists (for first-time setup).
   * If created, the password is written to a file on disk (not returned in
   * the response) to avoid it appearing in logs or process output.
   * `passwordFile` is the path to that file when `created` is true.
   */
  ensureDefaultAdmin(): Promise<{ created: boolean; passwordFile?: string }>;
}

/**
 * Create a user manager backed by @dune/core's UserStore.
 */
export function createUserManager(config: UserManagerConfig): UserManager {
  const { storage, usersDir } = config;
  const store: UserStore = createLocalUserStore({ storage, usersDir });

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

  async function ensureDefaultAdmin(): Promise<{ created: boolean; passwordFile?: string }> {
    const allUsers = await store.list();
    const admins = allUsers.filter((u) => u.enabled && u.roles.includes("admin"));

    if (admins.length > 0) {
      if (admins.length > 1) {
        console.warn(`[dune/users] ⚠️  Found ${admins.length} enabled admin users (${admins.map((u) => u.username).join(", ")})`);
      }
      return { created: false };
    }

    if (allUsers.length > 0) {
      console.warn(`[dune/users] ⚠️  Found ${allUsers.length} user(s) but none are enabled admins — creating default admin`);
    }

    // Generate a random password and write it to a file — never log it.
    const password = generatePassword();

    await create({
      username: "admin",
      email: "admin@localhost",
      password,
      role: "admin",
      name: "Admin",
    });

    // Write the password to a file next to the users directory.
    // The caller can print the file path; the password never appears in logs.
    const passwordFile = `${usersDir}/../initial-password.txt`;
    const content = `Dune CMS — initial admin password\n\nUsername: admin\nPassword: ${password}\n\nDelete this file after logging in and changing your password.\n`;
    await storage.write(passwordFile, new TextEncoder().encode(content));

    return { created: true, passwordFile };
  }

  return {
    create,
    getById: store.getById,
    getByUsername: store.getByUsername,
    list: store.list,
    update,
    changePassword,
    delete: store.delete,
    ensureDefaultAdmin,
  };
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}
