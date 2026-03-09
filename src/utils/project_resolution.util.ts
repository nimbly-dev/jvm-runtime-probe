import type { DiscoveredProject } from "../models/project_discovery.model";
import { inferTargets, type InferredTarget } from "../tools/core/target_infer/domain";

export type ProjectScopedInferenceCandidate = InferredTarget & {
  projectId: string;
  projectRootAbs: string;
};

export type ProjectResolutionResult =
  | {
      kind: "resolved_project";
      resolutionMode: "project_id" | "service_hint" | "single_project" | "workspace_root";
      workspaceRootAbs: string;
      projectId?: string;
      projectRootAbs: string;
    }
  | {
      kind: "selector_not_found";
      resolutionMode: "project_id" | "service_hint";
      workspaceRootAbs: string;
      selectorValue: string;
      availableProjects: Array<{ id: string; rootAbs: string }>;
      nextAction: string;
    }
  | {
      kind: "cross_project_inference";
      resolutionMode: "cross_project";
      workspaceRootAbs: string;
      scannedJavaFiles: number;
      candidates: ProjectScopedInferenceCandidate[];
      topConfidence?: number;
      topProjectIds: string[];
      selectedProjectId?: string;
      selectedProjectRootAbs?: string;
      isAmbiguous: boolean;
    };

type ResolveArgs = {
  workspaceRootAbs: string;
  projects: DiscoveredProject[];
  projectId?: string;
  serviceHint?: string;
  classHint?: string;
  methodHint?: string;
  lineHint?: number;
  maxCandidates?: number;
};

type InferTargetsFn = typeof inferTargets;

function buildAvailableProjects(projects: DiscoveredProject[]): Array<{ id: string; rootAbs: string }> {
  return projects.map((p) => ({ id: p.id, rootAbs: p.rootAbs }));
}

function buildSelectorNotFoundNextAction(selectorName: "projectId" | "serviceHint"): string {
  return `Provide a valid ${selectorName} from project_list, or omit it to allow cross-project inference.`;
}

function sortProjectCandidates(
  candidates: ProjectScopedInferenceCandidate[],
): ProjectScopedInferenceCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const al = typeof a.line === "number" ? a.line : Number.MAX_SAFE_INTEGER;
    const bl = typeof b.line === "number" ? b.line : Number.MAX_SAFE_INTEGER;
    if (al !== bl) return al - bl;
    return a.projectRootAbs.localeCompare(b.projectRootAbs);
  });
}

export async function resolveProjectForInference(
  args: ResolveArgs,
  deps?: { inferTargetsFn?: InferTargetsFn },
): Promise<ProjectResolutionResult> {
  const inferTargetsFn = deps?.inferTargetsFn ?? inferTargets;
  const projects = args.projects;

  if (projects.length === 0) {
    return {
      kind: "resolved_project",
      resolutionMode: "workspace_root",
      workspaceRootAbs: args.workspaceRootAbs,
      projectRootAbs: args.workspaceRootAbs,
    };
  }

  if (args.projectId) {
    const found = projects.find((p) => p.id === args.projectId);
    if (!found) {
      return {
        kind: "selector_not_found",
        resolutionMode: "project_id",
        workspaceRootAbs: args.workspaceRootAbs,
        selectorValue: args.projectId,
        availableProjects: buildAvailableProjects(projects),
        nextAction: buildSelectorNotFoundNextAction("projectId"),
      };
    }
    return {
      kind: "resolved_project",
      resolutionMode: "project_id",
      workspaceRootAbs: args.workspaceRootAbs,
      projectId: found.id,
      projectRootAbs: found.rootAbs,
    };
  }

  if (args.serviceHint) {
    const needle = args.serviceHint.toLowerCase();
    const found = projects.find((p) => p.rootAbs.toLowerCase().includes(needle));
    if (!found) {
      return {
        kind: "selector_not_found",
        resolutionMode: "service_hint",
        workspaceRootAbs: args.workspaceRootAbs,
        selectorValue: args.serviceHint,
        availableProjects: buildAvailableProjects(projects),
        nextAction: buildSelectorNotFoundNextAction("serviceHint"),
      };
    }
    return {
      kind: "resolved_project",
      resolutionMode: "service_hint",
      workspaceRootAbs: args.workspaceRootAbs,
      projectId: found.id,
      projectRootAbs: found.rootAbs,
    };
  }

  if (projects.length === 1) {
    return {
      kind: "resolved_project",
      resolutionMode: "single_project",
      workspaceRootAbs: args.workspaceRootAbs,
      projectId: projects[0]!.id,
      projectRootAbs: projects[0]!.rootAbs,
    };
  }

  const maxCandidates = Math.max(1, Math.min(args.maxCandidates ?? 8, 20));
  const scopedCandidates: ProjectScopedInferenceCandidate[] = [];
  let scannedJavaFiles = 0;

  for (const project of projects) {
    const inferred = await inferTargetsFn({
      rootAbs: project.rootAbs,
      ...(args.classHint ? { classHint: args.classHint } : {}),
      ...(args.methodHint ? { methodHint: args.methodHint } : {}),
      ...(typeof args.lineHint === "number" ? { lineHint: args.lineHint } : {}),
      maxCandidates,
    });
    scannedJavaFiles += inferred.scannedJavaFiles;
    for (const candidate of inferred.candidates) {
      scopedCandidates.push({
        ...candidate,
        projectId: project.id,
        projectRootAbs: project.rootAbs,
      });
    }
  }

  const candidates = sortProjectCandidates(scopedCandidates).slice(0, maxCandidates);
  const topConfidence = candidates[0]?.confidence;
  const topProjectIds =
    typeof topConfidence === "number"
      ? Array.from(
          new Set(
            candidates
              .filter((candidate) => candidate.confidence === topConfidence)
              .map((candidate) => candidate.projectId),
          ),
        )
      : [];

  return {
    kind: "cross_project_inference",
    resolutionMode: "cross_project",
    workspaceRootAbs: args.workspaceRootAbs,
    scannedJavaFiles,
    candidates,
    ...(typeof topConfidence === "number" ? { topConfidence } : {}),
    topProjectIds,
    ...(() => {
      if (topProjectIds.length !== 1) return {};
      const selectedProjectId = topProjectIds[0];
      if (!selectedProjectId) return {};
      const selectedProjectRootAbs = candidates.find((c) => c.projectId === topProjectIds[0])
        ?.projectRootAbs;
      return selectedProjectRootAbs
        ? {
            selectedProjectId,
            selectedProjectRootAbs,
          }
        : {};
    })(),
    isAmbiguous: topProjectIds.length > 1,
  };
}
