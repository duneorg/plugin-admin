/** PUT + DELETE /admin/api/users/:id */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../../_utils.ts";
import { toUserInfo } from "../../../../types.ts";
import { highestValidRole } from "../../../../auth/role-utils.ts";
import { DuplicateEmailError } from "@dune/core/auth/user-store";
import type { FreshContext } from "fresh";

export const handler = {
  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "users.update");
    if (denied) return denied;

    const { users, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const userId = ctx.params.id;

    try {
      const body = await ctx.req.json();
      const { name, email, role, enabled } = body;

      if (role !== undefined && !authResult.user?.roles.includes("admin")) {
        return json({ error: "Only admins can change user roles" }, 403);
      }
      if (role === "admin" && !authResult.user?.roles.includes("admin")) {
        return json({ error: "Only admins can assign admin role" }, 403);
      }
      if (role !== undefined) {
        const VALID_ROLES = ["admin", "editor", "author"] as const;
        if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
      }

      const updates: Partial<{ name: string; email: string; role: "admin" | "editor" | "author"; enabled: boolean }> = {};
      if (name !== undefined) updates.name = String(name);
      if (email !== undefined) updates.email = String(email);
      if (role !== undefined) updates.role = role;
      if (enabled !== undefined) updates.enabled = Boolean(enabled);

      // Prevent demotion or disabling of the last enabled admin.
      // Without this guard an admin could lose all admin access with no
      // recovery path via the admin panel.
      const wouldDemote = role !== undefined && role !== "admin";
      const wouldDisable = enabled !== undefined && !enabled;
      const targetUser = await users.getById(userId);
      if (targetUser?.roles.includes("admin") && (wouldDemote || wouldDisable)) {
        const allUsers = await users.list();
        const remainingAdmins = allUsers.filter(
          (u) => u.roles.includes("admin") && u.enabled && u.id !== userId,
        ).length;
        if (remainingAdmins === 0) {
          const action = wouldDemote ? "demote" : "disable";
          return json({ error: `Cannot ${action} the last admin account` }, 409);
        }
      }

      // Sync authz tuples. Read the current user record once for both checks.
      // Done before the store update so the current role is still readable.
      const { authz } = ctx.state.adminContext;
      if (authz && (role !== undefined || enabled !== undefined)) {
        const existing = targetUser;
        if (existing) {
          const existingRole = highestValidRole(existing.roles);
          if (role !== undefined) {
            // Role change: revoke old relation (if the account had one), grant new one.
            if (existingRole) {
              await authz.disallowAllMatching({
                who: { type: "user", id: userId },
                was: existingRole,
                onWhat: { type: "app", id: "admin" },
              }).catch((err) => {
                console.warn(`[dune/authz] disallowAllMatching failed on role change for user ${userId}:`, err);
              });
            }
            await authz.allow({
              who: { type: "user", id: userId },
              toBe: role,
              onWhat: { type: "app", id: "admin" },
            });
          }
          if (enabled !== undefined) {
            if (!enabled) {
              // Disabling: revoke all admin app tuples so authz.check() fails even
              // if session auth is somehow bypassed (defence-in-depth).
              await authz.disallowAllMatching({
                who: { type: "user", id: userId },
              }).catch((err) => {
                console.warn(`[dune/authz] disallowAllMatching failed on disable for user ${userId}:`, err);
              });
            } else if (enabled && !existing.enabled) {
              // Re-enabling: restore the tuple for their current (or newly set) role.
              const effectiveRole = role ?? existingRole;
              if (effectiveRole) {
                await authz.allow({
                  who: { type: "user", id: userId },
                  toBe: effectiveRole,
                  onWhat: { type: "app", id: "admin" },
                }).catch((err) => {
                  console.warn(`[dune/authz] allow failed on re-enable for user ${userId}:`, err);
                });
              }
            }
          }
        }
      }

      let updated;
      try {
        updated = await users.update(userId, updates);
      } catch (err) {
        if (err instanceof DuplicateEmailError) {
          return json({ error: "Email already in use" }, 409);
        }
        throw err;
      }
      if (!updated) return json({ error: "User not found" }, 404);

      void auditLogger?.log({
        event: "user.update",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: userId },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true, user: toUserInfo(updated) });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "users.delete");
    if (denied) return denied;

    const { users, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    const userId = ctx.params.id;

    try {
      if (authResult.user?.id === userId) {
        return json({ error: "Cannot delete your own account" }, 400);
      }

      // Prevent removing the last enabled admin — doing so would lock everyone
      // out of the admin panel with no recovery path via the UI.
      const targetUser = await users.getById(userId);
      if (targetUser?.roles.includes("admin")) {
        const allUsers = await users.list();
        const remainingAdmins = allUsers.filter(
          (u) => u.roles.includes("admin") && u.enabled && u.id !== userId,
        ).length;
        if (remainingAdmins === 0) {
          return json({ error: "Cannot delete the last admin account" }, 409);
        }
      }

      // Remove all authz tuples for the deleted user so no stale permissions remain.
      const { authz } = ctx.state.adminContext;
      if (authz) {
        await authz.disallowAllMatching({
          who: { type: "user", id: userId },
        }).catch((err) => {
          console.warn(`[dune/authz] disallowAllMatching failed on delete for user ${userId}:`, err);
        });
      }
      const deleted = await users.delete(userId);
      if (!deleted) return json({ error: "User not found" }, 404);

      void auditLogger?.log({
        event: "user.delete",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: userId },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
