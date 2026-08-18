/** GET + POST /admin/api/users */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../_utils.ts";
import { toUserInfo } from "../../../types.ts";
import { checkPasswordStrength } from "@dune/core/security";
import { DuplicateEmailError } from "@dune/core/auth/user-store";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "users.read");
    if (denied) return denied;
    const { users } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    try {
      const all = await users.list();
      const currentUserId = authResult.user?.id ?? "";
      const isAdmin = authResult.user?.roles.includes("admin") ?? false;
      return json({ users: all.map(toUserInfo), total: all.length, currentUserId, isAdmin });
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "users.create");
    if (denied) return denied;

    const { users, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { username, email, password, role, name } = body;

      if (!username || !password || !role) {
        return json({ error: "username, password, and role are required" }, 400);
      }

      const strength = checkPasswordStrength(password);
      if (!strength.ok) return json({ error: strength.reason }, 400);

      const VALID_ROLES = ["admin", "editor", "author"] as const;
      if (!VALID_ROLES.includes(role)) {
        return json({ error: `Invalid role: must be one of ${VALID_ROLES.join(", ")}` }, 400);
      }
      if (role === "admin" && !authResult.user?.roles.includes("admin")) {
        return json({ error: "Only admins can create admin-role users" }, 403);
      }

      const existing = await users.getByUsername(username);
      if (existing) return json({ error: "Username already exists" }, 409);

      let user;
      try {
        user = await users.create({
          username,
          // The unified User store (dec-identity-unification Phase 5b) enforces
          // email uniqueness — synthesize a per-username placeholder rather
          // than defaulting every email-less admin account to the same "",
          // which would collide on the second such account.
          email: email || `${username}@local`,
          password,
          role,
          name: name ?? username,
        });
      } catch (err) {
        if (err instanceof DuplicateEmailError) {
          return json({ error: "Email already in use" }, 409);
        }
        throw err;
      }

      // Sync the new user's role into the authz tuple store immediately so
      // they can access the admin panel without waiting for a restart + bootstrap.
      const { authz } = ctx.state.adminContext;
      if (authz) {
        await authz.allow({
          who: { type: "user", id: user.id },
          toBe: role,
          onWhat: { type: "app", id: "admin" },
        }).catch(() => {});
      }

      void auditLogger?.log({
        event: "user.create",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "user", id: user.id },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ created: true, user: toUserInfo(user) }, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
