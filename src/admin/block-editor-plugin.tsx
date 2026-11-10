/** @jsxImportSource preact */
/**
 * Built-in block editor — the default ContentEditorPlugin loaded by bootstrap
 * when no plugin provides the `admin.editor` capability.
 *
 * Wraps the PageEditor island in the same way the old hardwired route did, but
 * now as a proper ContentEditorPlugin so it participates in the same slot that
 * third-party editors use.
 */

import type { ContentEditorPlugin } from "./contributions.ts";
import type { FreshContext } from "fresh";
import PageEditor from "./islands/PageEditor.tsx";

function PageEditorRoute(
  { data }: { data: { pagePath: string; pageIndex: unknown; prefix: string; embedded: boolean } },
) {
  return (
    <div class="s-763f1850">
      <PageEditor
        pagePath={data.pagePath}
        pageIndex={data.pageIndex}
        prefix={data.prefix}
        embedded={data.embedded}
      />
    </div>
  );
}

export function createBlockEditorPlugin(): ContentEditorPlugin {
  return {
    // A full Fresh context (ctx.render): the contract's PluginRouteContext is narrowed here,
    // which the contract allows because this plugin depends on Fresh itself.
    // deno-lint-ignore no-explicit-any
    pageEditorHandler(ctx: FreshContext<any>) {
      const { engine, prefix } = ctx.state.adminContext;
      const pagePath = ctx.url.searchParams.get("path");
      if (!pagePath) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${prefix}/pages` },
        });
      }
      // deno-lint-ignore no-explicit-any
      const pageIndex = (engine.pages as any[]).find((p) => p.sourcePath === pagePath);
      const embedded = ctx.url.searchParams.get("embedded") === "1";
      return ctx.render(
        <PageEditorRoute data={{ pagePath, pageIndex, prefix, embedded }} />,
      );
    },
  };
}
