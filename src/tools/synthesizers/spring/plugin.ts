import type { SynthesizerInput } from "@/models/synthesis/synthesizer_input.model";
import { isSpringProject } from "@/utils/synthesizers/spring/detect.util";
import { synthesizeSpringRecipe } from "@/utils/synthesizers/spring/synthesis.util";
import { SYNTHESIZER_PLUGIN_API_VERSION } from "@/tools/synthesizers/registry/plugin.compat";
import type { SynthesizerPlugin } from "@/tools/synthesizers/registry/plugin.contract";

export const springSynthesizerPlugin: SynthesizerPlugin = {
  id: "spring",
  framework: "spring",
  pluginApiVersion: SYNTHESIZER_PLUGIN_API_VERSION,
  async canHandle(input: SynthesizerInput): Promise<boolean> {
    return isSpringProject(input.rootAbs);
  },
  async synthesize(input: SynthesizerInput) {
    return synthesizeSpringRecipe(input);
  },
};
