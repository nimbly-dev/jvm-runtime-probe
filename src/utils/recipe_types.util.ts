import type { IntentMode } from "./recipe_constants.util";

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
  selectedMode: IntentMode;
  routingReason: string;
  steps: RecipeExecutionStep[];
};
