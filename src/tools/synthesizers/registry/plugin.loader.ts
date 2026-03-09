import type { SynthesizerInput } from "../../../models/synthesis/synthesizer_input.model";
import type { SynthesizerFailure } from "../../../models/synthesis/synthesizer_failure.model";
import { springSynthesizerPlugin } from "../spring/plugin";
import { assertPluginCompatibility } from "./plugin.compat";
import type { SynthesizerPlugin, SynthesizerResult } from "./plugin.contract";

export class SynthesizerRegistry {
  private readonly plugins: SynthesizerPlugin[];

  constructor(plugins: SynthesizerPlugin[]) {
    plugins.forEach(assertPluginCompatibility);
    this.plugins = plugins;
  }

  listCapabilities(): Array<{ id: string; framework: string; pluginApiVersion: string }> {
    return this.plugins.map((plugin) => ({
      id: plugin.id,
      framework: plugin.framework,
      pluginApiVersion: plugin.pluginApiVersion,
    }));
  }

  async synthesize(input: SynthesizerInput): Promise<SynthesizerResult> {
    for (const plugin of this.plugins) {
      if (!(await plugin.canHandle(input))) continue;
      return plugin.synthesize(input);
    }
    const out: SynthesizerFailure = {
      status: "report",
      reasonCode: "synthesizer_not_installed",
      failedStep: "plugin_selection",
      nextAction:
        "No compatible synthesizer plugin is installed for this project. Install the spring synthesizer pack or provide a supported framework plugin.",
      evidence: ["No registered synthesizer returned canHandle=true."],
      attemptedStrategies: ["registry_plugin_selection"],
    };
    return out;
  }
}

export function createDefaultSynthesizerRegistry(): SynthesizerRegistry {
  return new SynthesizerRegistry([springSynthesizerPlugin]);
}
