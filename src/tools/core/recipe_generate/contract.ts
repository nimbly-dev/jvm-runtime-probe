import { RecipeGenerateInputSchema } from "@/models/inputs";

export const RECIPE_CREATE_TOOL = {
  name: "probe_recipe_create",
  description:
    "Generate a reproducible request recipe for hitting a target method, inferred from code hints via synthesizer plugins. Includes auth/login hints when available.",
  inputSchema: RecipeGenerateInputSchema,
} as const;
