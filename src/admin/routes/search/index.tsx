/** @jsxImportSource preact */
/** GET /admin/search — search engine management */


import type { AdminState } from "../../types.ts";
import SearchPanel from "../../islands/SearchPanel.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { auth, prefix } = ctx.state.adminContext;
    if (!auth.hasPermission(ctx.state.auth, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<SearchRoute data={{ prefix }} />);
  },
};

export default function SearchRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header"><h2>Search</h2></div>
      <SearchPanel prefix={data.prefix} />
    </div>
  );
}
