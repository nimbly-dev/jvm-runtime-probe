import * as z from "zod/v4";

export const TargetInferInputSchema = {
  projectRootAbs: z
    .string()
    .describe(
      "Project root selected by orchestrator (absolute or relative to workspace); all inference stays scoped here.",
    ),
  discoveryMode: z
    .enum(["ranked_candidates", "class_methods"])
    .optional()
    .describe(
      "Discovery mode. ranked_candidates (default) or class_methods (deterministic class inventory).",
    ),
  classHint: z
    .string()
    .optional()
    .describe("Exact class hint (prefer FQCN), e.g. com.example.catalog.CatalogShoeSpecifications"),
  methodHint: z.string().optional().describe("Method hint, e.g. finalPriceLte"),
  lineHint: z.number().int().positive().optional().describe("Optional line hint"),
  maxCandidates: z.number().int().positive().optional(),
} as const;
