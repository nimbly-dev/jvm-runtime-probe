import type { IntentMode } from "../../utils/recipe_constants.util";

export type NormalizedRecipeGenerateInput = {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  intentMode: IntentMode;
  lineHint?: number;
  maxCandidates: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  actuationEnabled: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
  authLoginDiscoveryEnabled: boolean;
};

export function normalizeRecipeGenerateInput(args: {
  rootAbs: string;
  workspaceRootAbs: string;
  classHint: string;
  methodHint: string;
  lineHint?: number;
  intentMode: IntentMode;
  maxCandidates?: number;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  actuationEnabled?: boolean;
  actuationReturnBoolean?: boolean;
  actuationActuatorId?: string;
  authLoginDiscoveryEnabled: boolean;
}): NormalizedRecipeGenerateInput {
  return {
    rootAbs: args.rootAbs,
    workspaceRootAbs: args.workspaceRootAbs,
    classHint: args.classHint,
    methodHint: args.methodHint,
    intentMode: args.intentMode,
    ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
    maxCandidates: typeof args.maxCandidates === "number" ? Math.max(1, args.maxCandidates) : 1,
    ...(args.authToken ? { authToken: args.authToken } : {}),
    ...(args.authUsername ? { authUsername: args.authUsername } : {}),
    ...(args.authPassword ? { authPassword: args.authPassword } : {}),
    actuationEnabled: args.actuationEnabled === true,
    ...(typeof args.actuationReturnBoolean === "boolean"
      ? { actuationReturnBoolean: args.actuationReturnBoolean }
      : {}),
    ...(args.actuationActuatorId ? { actuationActuatorId: args.actuationActuatorId } : {}),
    authLoginDiscoveryEnabled: args.authLoginDiscoveryEnabled,
  };
}
