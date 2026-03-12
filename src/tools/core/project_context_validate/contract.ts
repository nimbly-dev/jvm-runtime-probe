import { ProjectContextValidateInputSchema } from "@/models/inputs";

export const PROJECT_CONTEXT_VALIDATE_TOOL = {
  name: "project_context_validate",
  description:
    "Validate orchestrator-provided projectRootAbs and return scoped project context signals (markers/source roots).",
  inputSchema: ProjectContextValidateInputSchema,
} as const;
