import * as z from "zod/v4";

export const ProjectContextValidateInputSchema = {
  projectRootAbs: z
    .string()
    .describe("Absolute project root path selected by the orchestrator."),
} as const;
