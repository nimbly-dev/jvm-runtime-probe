import type { IntentMode } from "@/utils/recipe_constants.util";

export type NormalizedRecipeGenerateInput = {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  intentMode: IntentMode;
  lineHint?: number;
  apiBasePath?: string;
  maxCandidates: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  actuationEnabled: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
};

export function normalizeRecipeGenerateInput(args: {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  lineHint?: number;
  apiBasePath?: string;
  intentMode: IntentMode;
  maxCandidates?: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  actuationEnabled?: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
}): NormalizedRecipeGenerateInput {
  const normalizedApiBasePath = normalizeApiBasePath(args.apiBasePath);
  return {
    rootAbs: args.rootAbs,
    workspaceRootAbs: args.workspaceRootAbs,
    classHint: args.classHint,
    methodHint: args.methodHint,
    intentMode: args.intentMode,
    ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
    ...(normalizedApiBasePath ? { apiBasePath: normalizedApiBasePath } : {}),
    maxCandidates: typeof args.maxCandidates === "number" ? Math.max(1, args.maxCandidates) : 1,
    ...(args.authToken ? { authToken: args.authToken } : {}),
    ...(args.authUsername ? { authUsername: args.authUsername } : {}),
    ...(args.authPassword ? { authPassword: args.authPassword } : {}),
    actuationEnabled: args.actuationEnabled === true,
    ...(typeof args.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: args.actuationReturnBoolean }
      : {}),
    ...(args.actuationActuatorId ? { actuationActuatorId: args.actuationActuatorId } : {}),
  };
}

function normalizeApiBasePath(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
  return withoutTrailingSlash || "/";
}
