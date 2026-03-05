import * as z from "zod/v4";

export const TargetInferInputSchema = {
  classHint: z.string().optional().describe("Class name hint, e.g. CatalogShoeSpecifications"),
  methodHint: z.string().optional().describe("Method hint, e.g. finalPriceLte"),
  lineHint: z.number().int().positive().optional().describe("Optional line hint"),
  serviceHint: z.string().optional().describe("Optional service hint to pick project root"),
  projectId: z.string().optional().describe("Optional discovered project id"),
  workspaceRoot: z.string().optional().describe("Optional workspace root override"),
  maxCandidates: z.number().int().positive().optional(),
} as const;
