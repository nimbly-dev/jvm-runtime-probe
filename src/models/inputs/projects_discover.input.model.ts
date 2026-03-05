import * as z from "zod/v4";

export const ProjectsDiscoverInputSchema = {
  workspaceRoot: z.string().optional().describe("Optional override workspace root"),
  maxProjects: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Elastic count, clamped server-side"),
  maxJavaFilesPerProject: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max Java files sampled per discovered project when inferring probe scope."),
} as const;
