/** @jsxImportSource preact */
/**
 * Admin shell layout — sidebar nav, top bar, content slot.
 * Applied to all routes under src/admin/routes/ via Fresh 2 layout convention.
 */

import type { h } from "preact";
import type { AdminState } from "../types.ts";
import { getNavItems } from "../nav.ts";
import { isRtl } from "@dune/core/i18n";
import { highestValidRole } from "../auth/role-utils.ts";
import {
  normalizePrefix,
  PUBLIC_PATHS,
  toAdminRelative,
} from "./_middleware.ts";
import { csrfTokenFromState } from "../auth/csrf.ts";
import { adminCss } from "../admin-css.ts";

function csrfMeta(state: AdminState) {
  const token = csrfTokenFromState(state);
  if (!token) return null;
  return <meta name="csrf-token" content={token} />;
}

export default function AdminLayout(
  { Component, state, url }: {
    Component: () => h.JSX.Element;
    state: AdminState;
    url: URL;
  },
) {
  // Fresh applies _layout.tsx globally, not scoped to the fsRoutes prefix.
  // For non-admin paths, render the component directly without the admin shell.
  const adminCtx = state.adminContext;
  if (!adminCtx || !url.pathname.startsWith(adminCtx.prefix)) {
    return <Component />;
  }

  // Public routes (login, logout) render their own standalone document —
  // login.tsx's LoginPage already emits a complete <html>/<head>/<body>
  // with its own styles. Wrapping it in the authenticated sidebar/topbar
  // shell nested a second <html> document inside the admin chrome and, for
  // unauthenticated visitors, showed the nav filtered as the default
  // "author" role instead of just not being shown at all.
  const normalizedPrefix = normalizePrefix(adminCtx.prefix);
  const publicPathCheck = toAdminRelative(url.pathname, normalizedPrefix);
  if (PUBLIC_PATHS.has(publicPathCheck)) {
    return <Component />;
  }

  const { config, prefix } = adminCtx;
  const siteLang = config.system.languages?.default ?? "en";
  const rtlOverride = config.system.languages?.rtl_override;
  const dir = isRtl(siteLang, rtlOverride) ? "rtl" : "ltr";

  // `?embedded=1` — used by @dune/plugin-inline-edit's "Edit source" overlay,
  // which opens /pages/edit inside an on-page iframe (see FRAMEABLE_PATHS in
  // _middleware.ts). The sidebar/topbar chrome makes sense standing alone on
  // its own page; floated over a content page in a modal it's redundant
  // (nowhere to navigate to — the surrounding page IS the site) and just eats
  // vertical space from an already-small iframe. Still emits a full document
  // with the shared admin stylesheet — only the shell markup is skipped, not
  // the CSS the editor itself depends on.
  if (url.searchParams.get("embedded") === "1") {
    return (
      <html lang={siteLang} dir={dir}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {csrfMeta(state)}
          <title>Dune Admin</title>
          <style>{adminCss(dir === "rtl")}</style>
          <style>
            {`body { height: 100vh; overflow: hidden; } .admin-content { padding: 0; height: 100%; } .s-763f1850 { height: 100% !important; }`}
          </style>
        </head>
        <body>
          <div class="admin-content">
            <Component />
          </div>
        </body>
      </html>
    );
  }

  const user = state.auth?.user;
  const userName = user?.name ?? user?.username ?? "Admin";
  const role = highestValidRole(user?.roles) ?? "author";
  // Real authz-backed permissions, computed per request by _middleware.ts's
  // computeNavPermissions() — replaces the flat ROLE_PERMISSIONS[role]
  // lookup removed in 3.0.0, so the sidebar can no longer show/hide items
  // based on a table that could silently drift from what authz.check()
  // would actually decide for a route.
  const userPermissions = state.permissions ?? [];

  const allNavItems = getNavItems();
  const navItems = allNavItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.permission && !userPermissions.includes(item.permission)) {
      return false;
    }
    return true;
  });

  const pathname = url.pathname;
  const adminRelative = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length)
    : pathname;

  function isActive(path: string): boolean {
    if (path === "/") return adminRelative === "/" || adminRelative === "";
    return adminRelative.startsWith(path);
  }

  // Group nav items
  const groups = ["content", "media", "settings", "system"] as const;
  const grouped = new Map<string, typeof navItems>();
  for (const item of navItems) {
    const g = item.group ?? "content";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(item);
  }

  return (
    <html lang={siteLang} dir={dir}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {csrfMeta(state)}
          <title>Dune Admin</title>
          <style>{adminCss(dir === "rtl")}</style>
        </head>
      <body>
        <div class="admin-layout">
          <div class="sidebar-overlay" id="sidebar-overlay" />
          <aside class="admin-sidebar" id="admin-sidebar">
            <div class="sidebar-brand">
              <a href={`${prefix}/`}>🏜️ Dune</a>
              <button
                type="button"
                class="sidebar-close"
                id="sidebar-close"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <nav class="sidebar-nav">
              {groups.map((group) => {
                const items = grouped.get(group);
                if (!items || items.length === 0) return null;
                return (
                  <div class="nav-group" key={group}>
                    <div class="nav-group-label">{group}</div>
                    {items.map((item) => (
                      <a
                        key={item.path}
                        href={`${prefix}${item.path}`}
                        class={`nav-item${
                          isActive(item.path) ? " active" : ""
                        }`}
                      >
                        <span class="nav-label">{item.label}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
              {/* Plugin-contributed groups */}
              {Array.from(grouped.entries())
                .filter(([g]) => !(groups as readonly string[]).includes(g))
                .map(([group, items]) => (
                  <div class="nav-group" key={group}>
                    <div class="nav-group-label">{group}</div>
                    {items.map((item) => (
                      <a
                        key={item.path}
                        href={`${prefix}${item.path}`}
                        class={`nav-item${
                          isActive(item.path) ? " active" : ""
                        }`}
                      >
                        <span class="nav-label">{item.label}</span>
                      </a>
                    ))}
                  </div>
                ))}
            </nav>
          </aside>
          <main class="admin-main">
            <header class="admin-topbar">
              <button
                type="button"
                class="sidebar-toggle"
                id="sidebar-toggle"
                aria-label="Open menu"
              >
                ☰
              </button>
              <div class="topbar-right">
                <span class="topbar-user">{userName}</span>
                <form
                  method="POST"
                  action={`${prefix}/login/logout`}
                  class="s-5677b988"
                >
                  <button type="submit" class="btn btn-sm">Sign out</button>
                </form>
              </div>
            </header>
            <div class="admin-content">
              <Component />
            </div>
          </main>
        </div>
        <script dangerouslySetInnerHTML={{ __html: sidebarScript() }} />
      </body>
    </html>
  );
}

function sidebarScript(): string {
  return `
    const toggle = document.getElementById('sidebar-toggle');
    const close = document.getElementById('sidebar-close');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('admin-sidebar');
    function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('visible'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }
    toggle?.addEventListener('click', openSidebar);
    close?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
  `;
}

