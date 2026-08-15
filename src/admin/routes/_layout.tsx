/** @jsxImportSource preact */
/**
 * Admin shell layout — sidebar nav, top bar, content slot.
 * Applied to all routes under src/admin/routes/ via Fresh 2 layout convention.
 */

import type { h } from "preact";
import type { AdminState } from "../types.ts";
import { getNavItems } from "../nav.ts";
import { isRtl } from "@dune/core/i18n";
import { ROLE_PERMISSIONS } from "../types.ts";
import { normalizePrefix, PUBLIC_PATHS, toAdminRelative } from "./_middleware.ts";

export default function AdminLayout(
  { Component, state, url }: { Component: () => h.JSX.Element; state: AdminState; url: URL },
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

  const user = state.auth?.user;
  const userName = user?.name ?? user?.username ?? "Admin";
  const role = user?.role ?? "author";
  const userPermissions = ROLE_PERMISSIONS[role] ?? [];

  const allNavItems = getNavItems();
  const navItems = allNavItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.permission && !userPermissions.includes(item.permission)) return false;
    return true;
  });

  const pathname = url.pathname;
  const adminRelative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

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
        <title>Dune Admin</title>
        <style>{adminCss(dir === "rtl")}</style>
      </head>
      <body>
        <div class="admin-layout">
          <div class="sidebar-overlay" id="sidebar-overlay" />
          <aside class="admin-sidebar" id="admin-sidebar">
            <div class="sidebar-brand">
              <a href={`${prefix}/`}>🏜️ Dune</a>
              <button type="button" class="sidebar-close" id="sidebar-close" aria-label="Close menu">✕</button>
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
                        class={`nav-item${isActive(item.path) ? " active" : ""}`}
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
                        class={`nav-item${isActive(item.path) ? " active" : ""}`}
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
              <button type="button" class="sidebar-toggle" id="sidebar-toggle" aria-label="Open menu">☰</button>
              <div class="topbar-right">
                <span class="topbar-user">{userName}</span>
                <form method="POST" action={`${prefix}/login/logout`} class="s-5677b988">
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

function adminCss(rtl: boolean): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 220px;
      --topbar-h: 52px;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --bg: #f8f9fa;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #1a202c;
      --text-muted: #718096;
      --danger: #e53e3e;
    }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
    a { color: inherit; text-decoration: none; }

    /* Layout */
    .admin-layout { display: flex; min-height: 100vh; }
    .admin-sidebar {
      width: var(--sidebar-w); min-height: 100vh; background: var(--surface);
      border-${rtl ? "left" : "right"}: 1px solid var(--border);
      display: flex; flex-direction: column; flex-shrink: 0;
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
    }
    .admin-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .admin-content { flex: 1; padding: 24px; }

    /* Sidebar */
    .sidebar-brand {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px; font-size: 18px; font-weight: 700; border-bottom: 1px solid var(--border);
    }
    .sidebar-brand a { color: var(--text); }
    .sidebar-close { display: none; background: none; border: none; cursor: pointer; font-size: 18px; }
    .sidebar-nav { padding: 12px 0; }
    .nav-group { margin-bottom: 4px; }
    .nav-group-label {
      padding: 6px 16px 2px; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted);
    }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; border-radius: 6px; margin: 0 8px;
      color: var(--text); font-size: 14px; transition: background .15s;
    }
    .nav-item:hover { background: var(--bg); }
    .nav-item.active { background: #eef2ff; color: var(--accent); font-weight: 500; }

    /* Top bar */
    .admin-topbar {
      height: var(--topbar-h); display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; background: var(--surface); border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
    }
    .sidebar-toggle {
      background: none; border: none; cursor: pointer; font-size: 20px; padding: 4px 8px;
    }
    .topbar-right { display: flex; align-items: center; gap: 12px; }
    .topbar-user { font-size: 14px; color: var(--text-muted); }

    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500;
      border: 1px solid var(--border); background: var(--surface); cursor: pointer;
      color: var(--text); transition: background .15s;
    }
    .btn:hover { background: var(--bg); }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-sm { padding: 4px 10px; font-size: 13px; }
    .btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }

    /* Tables */
    .admin-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .admin-table th { text-align: ${rtl ? "right" : "left"}; padding: 10px 12px; background: var(--bg); border-bottom: 1px solid var(--border); font-weight: 600; }
    .admin-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .admin-table tr:hover td { background: var(--bg); }

    /* Forms */
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input[type=text], input[type=email], input[type=password], select, textarea {
      width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
      font-size: 14px; background: var(--surface);
    }
    input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); border-color: transparent; }

    /* Alerts */
    .alert { padding: 10px 14px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
    .alert-error { background: #fff5f5; border: 1px solid #fed7d7; color: var(--danger); }
    .alert-success { background: #f0fff4; border: 1px solid #c6f6d5; color: #276749; }

    /* Stats */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .stat-number { font-size: 28px; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .badge-md { background: #ebf8ff; color: #2b6cb0; }
    .badge-mdx { background: #f0fff4; color: #276749; }
    .badge-tsx { background: #faf5ff; color: #6b46c1; }

    /* Overlay + mobile sidebar */
    .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 40; }
    .sidebar-overlay.visible { display: block; }
    @media (max-width: 768px) {
      .admin-sidebar {
        position: fixed; ${rtl ? "right" : "left"}: 0; top: 0; z-index: 50;
        transform: translate${rtl ? "X(100%)" : "X(-100%)"};
        transition: transform .25s;
      }
      .admin-sidebar.open { transform: translateX(0); }
      .sidebar-close { display: block; }
    }
    @media (min-width: 769px) { .sidebar-toggle { display: none; } }

    /* Island mount targets */
    .island-root { min-height: 60px; }

    /* Section headers */
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .section-header h2 { font-size: 20px; font-weight: 600; }

    /* Metrics dashboard */
    .metric-card { border: 1px solid var(--border); border-radius: 8px; padding: 1rem; background: var(--surface); }
    .metric-card-highlight { border-color: #fed7d7; background: #fff5f5; }
    .metric-card-value { font-size: 1.5rem; font-weight: 700; color: #2d3748; }
    .metric-card-value-highlight { color: var(--danger); }
    .bar-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; }
    .bar-fill { height: 8px; border-radius: 4px; }
    .bar-fill-ok { background: var(--accent); }
    .bar-fill-warn { background: #f59e0b; }
    .bar-fill-danger { background: var(--danger); }
    .text-danger { color: var(--danger); }

    /* Extracted from inline style="" attributes across admin islands/routes —
       plugin-admin's CSP (useNonce: true) drops 'unsafe-inline' from style-src,
       and Fresh only auto-nonces <style>/<script> elements it renders itself,
       never style="" attribute values, so raw inline styles were silently
       blocked. Class names are content hashes (s-<md5-prefix>), generated
       mechanically from each unique style string — not meant to be hand-edited;
       regenerate by re-extracting rather than adding to this list by hand. */
    .s-01282aa4 { font-size:0.8rem;color:#a0aec0;margin-top:0.25rem }
    .s-0223e5e4 { background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:0.75rem;margin-top:0.5rem }
    .s-049af8ec { margin:0;white-space:nowrap }
    .s-04a2236a { color:#38a169;margin-bottom:1rem }
    .s-04ce2983 { font-size:0.85rem;color:#718096 }
    .s-06602b4f { font-size:0.8rem;color:#c53030;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .s-076e1d4d { font-size:0.85rem }
    .s-0ac2ae96 { display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap }
    .s-0b5d16f0 { background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px }
    .s-0f69679b { display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem }
    .s-1386d503 { margin:0 }
    .s-14ae7afe { display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem }
    .s-17a730ae { color:#718096;padding:2rem 0 }
    .s-19ec2070 { display:flex;align-items:center;justify-content:center;height:400px;color:#a0aec0;font-size:0.875rem }
    .s-1b859768 { display:flex;align-items:center;gap:0.5rem;font-size:0.9rem }
    .s-1e29eefb { font-weight:500 }
    .s-1eb2babc { color:#e53e3e;padding:2rem 0 }
    .s-21f8d78f { font-size:0.75rem;color:#718096;margin-top:0.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
    .s-2971273c { display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem }
    .s-297d7857 { margin-left:auto;display:flex;align-items:center;gap:0.75rem }
    .s-2a4cda41 { color:#f59e0b }
    .s-2a9780cb { display:flex;align-items:center;gap:8px }
    .s-2e33ae4a { display:grid;grid-template-columns:320px 1fr;gap:1.5rem;align-items:start }
    .s-2e9f9b64 { border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;min-height:400px }
    .s-3044b600 { font-size:13px }
    .s-31db4ccc { display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem }
    .s-3353514d { font-size:0.7rem;color:#a0aec0;margin-top:0.1rem }
    .s-358b17e7 { margin-top:1.5rem;display:flex;gap:0.75rem;align-items:center }
    .s-375dd3c3 { font-size:0.8rem;color:#718096 }
    .s-37b5834e { font-size:4rem;text-align:center;padding:2rem }
    .s-38f5682c { width:100%;height:600px;border:1px solid var(--border);border-radius:6px;background:#fff }
    .s-3adba436 { font-size:0.8rem;color:#718096;margin-right:0.5rem }
    .s-3b2074de { margin-bottom:0.5rem }
    .s-3c2db771 { margin:0 0 .75rem;font-size:1rem;font-weight:600 }
    .s-3cf64e05 { color:#718096;font-size:.875rem;margin:0 0 .75rem }
    .s-3e9d9c4c { max-width:600px }
    .s-3f29e863 { font-size:0.8rem;color:#718096;margin-top:0.25rem }
    .s-402564c4 { margin-bottom:0.75rem }
    .s-47790cc9 { width:100%;height:160px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;color:#a0aec0;font-size:2rem }
    .s-48624e4b { font-weight:600;margin-bottom:0.25rem }
    .s-48e36cb6 { max-width:400px;max-height:300px;display:block }
    .s-49c5b5cd { width:100%;height:160px;object-fit:cover }
    .s-4a1a0733 { background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1rem;overflow:auto;font-size:0.85rem;max-height:60vh }
    .s-4bf94c79 { background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:1rem;margin-bottom:1rem }
    .s-4d5cad12 { padding:1rem;border-bottom:1px solid #e2e8f0;background:#f7fafc }
    .s-4dc05622 { font-size:0.75rem }
    .s-4dd59aa6 { max-width:640px }
    .s-4e407366 { border:none;background:none;cursor:pointer;padding:0;line-height:1 }
    .s-4f77c842 { color:#718096 }
    .s-5050775b { width:100%;height:100%;border:none }
    .s-516a4d34 { display:flex;flex-direction:column;gap:.5rem }
    .s-51f08752 { margin:0;white-space:pre-wrap;font-size:0.85rem }
    .s-53896af7 { margin-top:0 }
    .s-559a05d5 { margin-bottom:12px;font-size:16px;font-weight:600 }
    .s-5677b988 { display:inline }
    .s-57925e75 { border:1px solid #e2e8f0;border-radius:8px;padding:1rem }
    .s-57fe2250 { font-weight:600;width:160px }
    .s-5b4cfbc9 { font-size:0.8rem;color:#718096;margin-bottom:0.25rem }
    .s-6059c7e1 { font-size:0.75rem;color:#a0aec0;margin-top:1rem }
    .s-609e15d9 { display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.25rem 0 }
    .s-6404d85c { font-weight:500;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
    .s-6a037922 { font-size:0.875rem }
    .s-6a1fb824 { position:relative;display:inline-block;cursor:crosshair }
    .s-6a7c8737 { width:40px;height:40px;border-radius:4px;object-fit:cover }
    .s-6a9767ee { color:#718096;font-size:0.9rem }
    .s-6b9c179a { font-size:12px }
    .s-6bb006fc { margin-top:0.25rem }
    .s-6d567387 { width:100% }
    .s-6e0691e8 { display:flex;align-items:center;gap:0.25rem }
    .s-6fe37944 { width:320px;flex-shrink:0 }
    .s-763f1850 { height:calc(100vh - 104px) }
    .s-773881f7 { position:fixed;bottom:1rem;right:1rem }
    .s-78c94453 { font-size:0.75rem;font-weight:400;color:#718096;margin-left:0.5rem }
    .s-79df0477 { color:#276749 }
    .s-7f1b1911 { padding:2rem;color:#718096 }
    .s-801fc590 { width:40px;height:40px;border-radius:4px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:1.5rem }
    .s-819192ef { display:flex;gap:0.5rem;flex-wrap:wrap }
    .s-831acaf6 { margin-top:2rem }
    .s-83456371 { margin-left:auto }
    .s-85a4ef6b { width:4rem;font-size:0.85rem;text-align:right }
    .s-87dab5e6 { padding:2rem 0;color:#718096 }
    .s-89bd09bd { flex:1;min-width:0 }
    .s-89c10cfd { background:#f6ad55;color:#744210;cursor:help }
    .s-8d1a5c1d { display:flex;align-items:center;gap:.75rem;cursor:pointer }
    .s-8e9e7137 { margin-top:1.5rem;border:1px solid #e2e8f0;border-radius:6px;padding:1rem }
    .s-90bda5a7 { display:flex;gap:0.5rem;align-items:center }
    .s-94b930f9 { display:flex;gap:0.25rem;flex-wrap:wrap;margin-bottom:0.75rem }
    .s-9590f79e { margin-bottom:1rem }
    .s-9ad6cb3a { border:1px solid #e2e8f0;border-radius:6px;padding:1rem;cursor:pointer;min-width:140px }
    .s-9dae1d00 { margin-top:1rem }
    .s-9dcdde5e { margin:0 0 0.75rem }
    .s-a22f7cc1 { margin-left:.5rem }
    .s-a4a6d1d8 { display:flex;justify-content:flex-end;margin-bottom:1rem }
    .s-aa1fe21d { display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem }
    .s-abcb745b { display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap }
    .s-ace205ad { color:#718096;font-size:0.85rem;margin-left:auto }
    .s-b06fb3de { margin-top:1.5rem }
    .s-b1c3a18b { font-size:0.875rem;color:#4a5568 }
    .s-b3f1a710 { white-space:nowrap;font-size:12px;color:#718096 }
    .s-b4e83a82 { width:100%;height:300px;border:1px solid #e2e8f0;border-radius:4px;margin-top:1rem }
    .s-b9732f3c { display:flex;gap:0.75rem;flex-wrap:wrap }
    .s-ba9f0926 { width:100%;height:500px;border:0;display:block }
    .s-bef9490d { display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.5rem }
    .s-bf1e2758 { color:#e53e3e;margin-bottom:1rem }
    .s-c7a8daea { padding:4px 12px;font-size:0.8rem;border:1px solid #cbd5e0;border-radius:4px;background:white;cursor:pointer }
    .s-c866c7be { font-size:12px;color:#718096 }
    .s-cac755ce { display:grid;grid-template-columns:1fr 1fr;gap:1rem }
    .s-cb458930 { display:none }
    .s-d0be2a48 { margin-left:auto;font-size:.75rem;color:#3182ce;font-weight:600 }
    .s-d109945c { margin-right:8px }
    .s-d13ab416 { font-size:0.9rem;color:#4a5568;margin:0 0 0.75rem }
    .s-d1e542ea { display:flex;gap:0.5rem }
    .s-d36754cf { padding:2rem;color:#e53e3e }
    .s-d59b2c04 { color:#e53e3e;margin-left:2px }
    .s-d77827f6 { color:#e53e3e;font-size:0.9rem }
    .s-d8241069 { width:3rem;font-size:0.85rem;color:#718096 }
    .s-d88d8b5a { font-size:0.75rem;color:#a0aec0 }
    .s-d89fdddb { padding:1rem;color:#718096 }
    .s-da472840 { margin-left:6px }
    .s-da92b19d { display:flex;gap:0.5rem;margin-top:0.75rem }
    .s-db27a9cf { font-size:15px;margin-bottom:8px }
    .s-db9feeed { display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap }
    .s-df2a69f4 { margin-bottom:2rem }
    .s-df643397 { color:#718096;font-size:0.85rem }
    .s-e0c704d9 { padding:1rem }
    .s-e3d4adcf { color:#718096;padding:1rem 0 }
    .s-e5de08ff { color:#276749;margin-right:1rem }
    .s-e634e6da { font-weight:600 }
    .s-e6a47de8 { font-size:0.8rem;color:#718096;margin-bottom:0.5rem }
    .s-ebdd5d0a { display:flex;gap:1.5rem;align-items:flex-start }
    .s-eda77236 { display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem }
    .s-eeaeeb40 { display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem }
    .s-f1334ee1 { border:1px solid #e2e8f0;border-radius:8px;overflow:hidden }
    .s-f1fe5575 { display:flex;flex-direction:column;gap:0.5rem;max-width:480px }
    .s-f53c0fbe { display:flex;align-items:center;gap:0.75rem }
    .s-4d14681b { max-width:300px }
    .s-dd76ed55 { max-width:240px }
    .s-da5cd676 { flex:1 }
    .s-724242e3 { width:100%;height:100%;font-family:monospace;font-size:14px;border:none;outline:none;resize:none;padding:1rem }
    .s-5285a128 { flex:1;max-width:320px }

    ${rtl ? `
    /* RTL adjustments */
    .admin-topbar { flex-direction: row-reverse; }
    .nav-item { flex-direction: row-reverse; }
    ` : ""}
  `;
}
