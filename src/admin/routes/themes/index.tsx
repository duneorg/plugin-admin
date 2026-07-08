/** @jsxImportSource preact */
/** GET /admin/themes — installed themes, active theme switcher, and theme settings */


import type { AdminState } from "../../types.ts";
import ThemeSwitcher from "../../islands/ThemeSwitcher.tsx";
import ThemeConfigEditor from "../../islands/ThemeConfigEditor.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { config, prefix } = ctx.state.adminContext;
    const previewSlug = ctx.url.searchParams.get("preview") ?? undefined;
    return ctx.render(<ThemesRoute data={{ activeTheme: config.theme.name, prefix, previewSlug }} />);
  },
};

export default function ThemesRoute(
  { data }: { data: { activeTheme: string; prefix: string; previewSlug?: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Themes</h2>
        <a href={`${data.prefix}/marketplace?tab=themes`} class="btn">Browse Marketplace</a>
      </div>

      <div class="cfg-section">
        <ThemeSwitcher prefix={data.prefix} activeTheme={data.activeTheme} previewSlug={data.previewSlug} />
      </div>

      <div class="cfg-section">
        <h4>Theme settings</h4>
        <ThemeConfigEditor prefix={data.prefix} />
      </div>
    </div>
  );
}
