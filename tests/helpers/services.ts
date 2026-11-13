import { createPluginServices } from "jsr:@dune/core@0.37/plugin-api";
import type { PluginServices, PluginServicesOptions } from "jsr:@dune/core@0.37/plugin-api";
import type { DuneConfig } from "jsr:@dune/core@0.37";
import type { StorageAdapter } from "jsr:@dune/core@0.37/storage";

/** Core's plugin services over a test storage (default config: local sessions). */
export function makeServices(
  storage: unknown,
  extra: Partial<PluginServicesOptions> = {},
): PluginServices {
  return createPluginServices({
    config: { system: {}, site: {} } as unknown as DuneConfig,
    storage: storage as StorageAdapter,
    ...extra,
  });
}
