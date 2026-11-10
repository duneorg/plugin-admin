/**
 * Machine translation module — re-exports all public types and classes.
 *
 * @module
 */

export type { MachineTranslationConfig, MachineTranslator, SafeFetch } from "./types.ts";
export { DeepLTranslator } from "./deepl.ts";
export { GoogleTranslator } from "./google.ts";
export { LibreTranslateTranslator } from "./libretranslate.ts";
export { createMachineTranslator } from "./factory.ts";
