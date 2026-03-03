export type RecipeCandidate = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  queryTemplate: string;
  fullUrlHint: string;
  bodyTemplate?: string;
  confidence?: number;
  assumptions?: string[];
  needsConfirmation?: string[];
  rationale: string[];
};

export type RecipeExecutionStep = {
  phase: "prepare" | "execute" | "verify" | "cleanup";
  title: string;
  instruction: string;
};

export type RecipeExecutionPlan = {
  mode: "natural" | "actuated";
  modeReason: string;
  naturalSteps: RecipeExecutionStep[];
  actuatedSteps: RecipeExecutionStep[];
};
