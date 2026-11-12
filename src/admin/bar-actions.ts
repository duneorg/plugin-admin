/**
 * What the admin adds to the inline-edit bar.
 *
 * The bar belongs to `@dune/plugin-inline-edit`, which knows nothing about an
 * admin; this plugin contributes its own buttons to the bar's `bar.actions`
 * point: a link to the page's editor here, and a button that opens that editor
 * in an overlay on the page.
 *
 * The contribution is made without importing the bar plugin's package (that would
 * make an optional neighbour a dependency), so the shapes and the key below are
 * this plugin's own restatement of the `BarAction` contract.
 *
 * @module
 */

import { type CapabilityKey, capabilityKey } from "@dune/plugin-api";

/** A bar button, as `@dune/plugin-inline-edit` renders it. */
export interface AdminBarAction {
  id: string;
  label: string;
  /** Renders as a link. */
  href?: string;
  /** Renders as a button running this script. */
  onClick?: string;
}

/** The part of the bar's per-response context this plugin reads. */
export interface AdminBarContext {
  page: { sourcePath: string } | null;
}

/**
 * The bar's `bar.actions` contribution point, recreated from its documented name
 * so this plugin needs no dependency on the bar's package: two keys with one
 * name are one capability.
 */
export const BAR_ACTIONS: CapabilityKey<(ctx: AdminBarContext) => AdminBarAction[]> = capabilityKey("bar.actions");

/**
 * Script for the "Edit source" button: show the admin's page editor
 * (`embedded=1` drops its sidebar and topbar, redundant over a content page) in
 * a full-screen overlay. Built on first click so nothing loads until asked;
 * Escape or Close hides it.
 */
function overlayScript(embeddedUrl: string): string {
  return `(function(){var id='dune-source-overlay',o=document.getElementById(id);` +
    `if(o){o.style.display='flex';return;}` +
    `var s=document.createElement('style');s.textContent='@media print{#'+id+'{display:none!important}}';document.head.appendChild(s);` +
    `o=document.createElement('div');o.id=id;` +
    `o.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;flex-direction:column';` +
    `var b=document.createElement('div');b.style.cssText='flex:none;display:flex;justify-content:flex-end;padding:8px 16px;background:#1a1a2e';` +
    `var c=document.createElement('button');c.type='button';c.textContent='\\u2715 Close';` +
    `c.style.cssText='background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit';` +
    `function hide(){o.style.display='none';}c.onclick=hide;b.appendChild(c);` +
    `var f=document.createElement('iframe');f.title='Edit source';f.style.cssText='flex:1;width:100%;border:none;background:#fff';` +
    `f.src=${JSON.stringify(embeddedUrl)};o.appendChild(b);o.appendChild(f);document.body.appendChild(o);` +
    `document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});})()`;
}

/** The admin's bar contribution for a page, or nothing off content pages. */
export function adminBarActions(prefix: string, ctx: AdminBarContext): AdminBarAction[] {
  if (!ctx.page) return [];
  // The edit route is `${prefix}/pages/edit?path=<source path>` (there is no
  // `/pages/<path>` route).
  const editUrl = `${prefix}/pages/edit?path=${encodeURIComponent(ctx.page.sourcePath)}`;
  return [
    { id: "admin:edit-source", label: "✎ Edit source", onClick: overlayScript(`${editUrl}&embedded=1`) },
    { id: "admin:open", label: "Open in admin →", href: editUrl },
  ];
}
