import { createPluginServices } from "@dune/core/plugin-api";
import type { PluginServices, PluginServicesOptions } from "@dune/core/plugin-api";
import type { DuneConfig } from "@dune/core/config";
import type { StorageAdapter } from "@dune/core/storage";

/** Core's plugin services over a test storage (default config: local sessions). */
export function makeServices(storage: unknown, extra: Partial<PluginServicesOptions> = {}): PluginServices {
  return createPluginServices({
    config: { system: {}, site: {} } as unknown as DuneConfig,
    storage: storage as StorageAdapter,
    ...extra,
  });
}
