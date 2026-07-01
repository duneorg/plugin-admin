# @dune/plugin-admin

The built-in admin panel for [Dune CMS](https://getdune.org), packaged as a standalone JSR plugin.

Provides the full web-based content management interface: page tree, block editor, media library, visual page builder, multi-stage workflow, real-time collaboration, i18n management, and more.

> **Pre-1.0** — Ships as part of Dune's standard distribution. Extracted from `@dune/core` in v0.24 to allow headless deployments and custom admin implementations.

## Usage

The plugin is auto-registered by `@dune/core` bootstrap unless explicitly disabled. No configuration is required for the default setup.

### Explicit registration (for custom wiring)

```ts
import { createAdminPlugin } from "@dune/plugin-admin";
import { bootstrap } from "@dune/core";

const result = await bootstrap({ root: Deno.cwd() });
// Admin is auto-registered; pass options to override defaults:
const adminPlugin = createAdminPlugin(result.config, result.storage, {
  root: Deno.cwd(),
  dev: false,
  // authProvider: myCustomAuthProvider,
});
```

### Disabling the admin panel

```yaml
# site.yaml
admin:
  enabled: false
```

This produces a headless Dune deployment — useful for statically generated sites or when you want a fully custom management interface.

## Configuration

All admin configuration lives under the `admin:` key in `site.yaml`.

```yaml
admin:
  path: /admin              # URL prefix for the admin panel (default: /admin)
  enabled: true             # Set to false to disable entirely
  sessionLifetime: 86400    # Session duration in seconds (default: 24h)
  dataDir: data             # Directory for users, submissions, etc.
  runtimeDir: .dune/admin   # Directory for sessions, audit log, etc.

  auth_provider:
    type: local             # Only "local" is supported today

  audit:
    enabled: true
    logFile: .dune/admin/audit.log   # Override the audit log path

  session_store:
    type: local             # "local" (default) or "redis"
    url: $REDIS_URL         # Required when type is redis
```

### Roles and permissions

The admin panel uses a three-tier role system:

| Role | Capabilities |
|------|-------------|
| `admin` | Full access — users, config, plugins, TSX content |
| `editor` | Content CRUD, media, workflow transitions |
| `author` | Own content only, cannot publish directly |

## What's included

### Content management
- Page tree with drag-and-drop reordering
- Block editor (rich text, images, embeds, custom blocks)
- Visual page builder (drag-and-drop sections)
- Revision history with visual diff and one-click restore
- Staging / preview before publish
- Inline editing from the frontend

### Media
- Upload, organize, and reference images and files
- Image processing pipeline (resize, quality, WebP conversion)

### Workflow
- Configurable multi-stage workflow (draft → in_review → published → archived)
- Scheduled publishing
- Email notifications on stage transitions (via webhook)

### Collaboration
- Real-time concurrent editing (OT-based conflict resolution)
- Internal comments and @mention notifications
- Audit log (15 event types, JSONL append-only)

### i18n
- Side-by-side translation editing
- Translation Memory (fuzzy matching, reuse rate reporting)
- Machine translation (DeepL, Google Translate, LibreTranslate)
- RTL language support

### Operations
- User and session management
- Plugin and theme marketplace
- Performance metrics dashboard (p50/p95/p99 latency, cache hit rate)
- Search engine management (active engine, parallel mode toggle)

## The `mount()` hook

`@dune/plugin-admin` uses the `DunePlugin.mount(api: MountApi)` lifecycle hook introduced in v0.24 to register its Fresh routes after bootstrap completes. This is the mechanism that allows the admin panel to be a first-class plugin rather than a hardcoded subsystem.

Third-party plugins that need to add routes to the admin panel can use the same hook:

```ts
import type { DunePlugin, MountApi } from "@dune/core/hooks";

const myPlugin: DunePlugin = {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
  async mount({ app, bootstrap }: MountApi) {
    app.get("/my-plugin/dashboard", myHandler);
  },
};
```

## Admin pages via plugins

Plugins can contribute pages to the admin sidebar navigation:

```ts
const myPlugin: DunePlugin = {
  name: "my-plugin",
  version: "1.0.0",
  adminPages: [
    {
      label: "My Plugin",
      path: "/my-plugin",
      icon: "puzzle",
    },
  ],
  hooks: {},
};
```

## License

MIT
