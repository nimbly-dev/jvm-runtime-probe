import type { SynthesizerPlugin } from "./plugin.contract";

export const SYNTHESIZER_PLUGIN_API_VERSION = "1.0.0";

export function assertPluginCompatibility(plugin: SynthesizerPlugin): void {
  if (plugin.pluginApiVersion !== SYNTHESIZER_PLUGIN_API_VERSION) {
    throw new Error(
      `Incompatible synthesizer plugin '${plugin.id}'. ` +
        `Expected pluginApiVersion=${SYNTHESIZER_PLUGIN_API_VERSION}, actual=${plugin.pluginApiVersion}.`,
    );
  }
}
