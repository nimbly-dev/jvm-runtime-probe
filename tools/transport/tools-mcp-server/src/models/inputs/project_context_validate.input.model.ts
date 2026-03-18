import * as z from "zod/v4";

export const ProjectContextValidateInputSchema = {
  projectRootAbs: z
    .string()
    .describe("Project root path selected by the orchestrator (absolute or relative to workspace)."),
} as const;
