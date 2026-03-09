import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServerConfig } from "../../../config/server-config";
import { clampInt } from "../../../lib/safety";
import { resolveProjectForInference } from "../../../utils/project_resolution.util";
import type { ProjectRuntime } from "../../../utils/project_discovery/project_runtime.util";
import { discoverClassMethods, inferTargets } from "./domain";
import { TARGET_INFER_TOOL } from "./contract";

export type TargetInferHandlerDeps = {
  config: ServerConfig;
  projectRuntime: ProjectRuntime;
};

export function registerTargetInferTool(server: McpServer, deps: TargetInferHandlerDeps): void {
  server.registerTool(
    TARGET_INFER_TOOL.name,
    {
      description: TARGET_INFER_TOOL.description,
      inputSchema: TARGET_INFER_TOOL.inputSchema,
    },
    async ({
      discoveryMode,
      classHint,
      methodHint,
      lineHint,
      serviceHint,
      projectId,
      workspaceRoot,
      maxCandidates,
    }) => {
      if (
        !deps.projectRuntime.explicitDiscoveryPerformed &&
        (!workspaceRoot || workspaceRoot.trim().length === 0)
      ) {
        const structuredContent = {
          resultType: "report",
          status: "workspace_discovery_required",
          nextAction:
            "Call project_list first (preferably with workspaceRoot set to the active project root), then rerun probe_target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const workspaceRootAbs = path.resolve(workspaceRoot ?? deps.config.workspaceRootAbs);
      const projects = await deps.projectRuntime.ensureProjects(workspaceRootAbs);
      const selectedDiscoveryMode = discoveryMode ?? "ranked_candidates";

      if (selectedDiscoveryMode === "class_methods") {
        const classHintTrimmed = classHint?.trim();
        if (!classHintTrimmed) {
          const structuredContent = {
            resultType: "report",
            status: "class_hint_required",
            workspaceRoot: workspaceRootAbs,
            nextAction:
              "Provide classHint and rerun probe_target_infer with discoveryMode=class_methods.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
          };
        }

        const scopedProjects: Array<{ projectId?: string; projectRootAbs: string }> = [];
        let projectResolution:
          | {
              mode: "workspace_root" | "single_project" | "cross_project";
              selectedProjectId?: string;
              selectedProjectRoot?: string;
            }
          | {
              mode: "project_id" | "service_hint";
              selectorValue: string;
              selectedProjectId?: string;
              selectedProjectRoot?: string;
            };

        if (projectId) {
          const found = projects.find((p) => p.id === projectId);
          if (!found) {
            const structuredContent = {
              resultType: "report",
              status: "project_resolution_failed",
              workspaceRoot: workspaceRootAbs,
              hints: { classHint, serviceHint, projectId },
              projectResolution: {
                mode: "project_id",
                selectorValue: projectId,
                availableProjects: projects.map((p) => ({ id: p.id, root: p.rootAbs })),
              },
              nextAction:
                "Provide a valid projectId from project_list, or omit projectId to allow wider class discovery.",
            };
            return {
              content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
              structuredContent,
            };
          }
          scopedProjects.push({ projectId: found.id, projectRootAbs: found.rootAbs });
          projectResolution = {
            mode: "project_id",
            selectorValue: projectId,
            selectedProjectId: found.id,
            selectedProjectRoot: found.rootAbs,
          };
        } else if (serviceHint) {
          const needle = serviceHint.toLowerCase();
          const found = projects.find((p) => p.rootAbs.toLowerCase().includes(needle));
          if (!found) {
            const structuredContent = {
              resultType: "report",
              status: "project_resolution_failed",
              workspaceRoot: workspaceRootAbs,
              hints: { classHint, serviceHint, projectId },
              projectResolution: {
                mode: "service_hint",
                selectorValue: serviceHint,
                availableProjects: projects.map((p) => ({ id: p.id, root: p.rootAbs })),
              },
              nextAction:
                "Provide a valid serviceHint from project_list, or omit serviceHint to allow wider class discovery.",
            };
            return {
              content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
              structuredContent,
            };
          }
          scopedProjects.push({ projectId: found.id, projectRootAbs: found.rootAbs });
          projectResolution = {
            mode: "service_hint",
            selectorValue: serviceHint,
            selectedProjectId: found.id,
            selectedProjectRoot: found.rootAbs,
          };
        } else if (projects.length === 0) {
          scopedProjects.push({ projectRootAbs: workspaceRootAbs });
          projectResolution = {
            mode: "workspace_root",
            selectedProjectRoot: workspaceRootAbs,
          };
        } else if (projects.length === 1) {
          scopedProjects.push({
            projectId: projects[0]!.id,
            projectRootAbs: projects[0]!.rootAbs,
          });
          projectResolution = {
            mode: "single_project",
            selectedProjectId: projects[0]!.id,
            selectedProjectRoot: projects[0]!.rootAbs,
          };
        } else {
          for (const project of projects) {
            scopedProjects.push({
              projectId: project.id,
              projectRootAbs: project.rootAbs,
            });
          }
          projectResolution = {
            mode: "cross_project",
          };
        }

        const exactMatches: Array<{
          file: string;
          className: string;
          fqcn?: string;
          methods: Array<{
            methodName: string;
            signature: string;
            startLine: number;
            endLine: number;
            probeKey?: string;
          }>;
          projectId?: string;
          projectRootAbs: string;
        }> = [];
        const partialMatches: typeof exactMatches = [];
        let scannedJavaFiles = 0;

        for (const scoped of scopedProjects) {
          const discovered = await discoverClassMethods({
            rootAbs: scoped.projectRootAbs,
            classHint: classHintTrimmed,
          });
          scannedJavaFiles += discovered.scannedJavaFiles;
          for (const c of discovered.classes) {
            const normalized = {
              ...c,
              projectRootAbs: scoped.projectRootAbs,
              ...(scoped.projectId ? { projectId: scoped.projectId } : {}),
            };
            if (discovered.matchMode === "exact") exactMatches.push(normalized);
            else if (discovered.matchMode === "partial") partialMatches.push(normalized);
          }
        }

        const chosenMatches = exactMatches.length > 0 ? exactMatches : partialMatches;

        if (chosenMatches.length === 0) {
          const structuredContent = {
            resultType: "class_methods",
            status: "class_not_found",
            workspaceRoot: workspaceRootAbs,
            hints: { classHint, serviceHint, projectId },
            scannedJavaFiles,
            projectResolution,
            nextAction:
              "Refine classHint (prefer exact class name or fully qualified class name) and rerun probe_target_infer.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
          };
        }

        const matches = chosenMatches.map((match) => ({
          className: match.className,
          ...(match.fqcn ? { fqcn: match.fqcn } : {}),
          file: path.relative(workspaceRootAbs, match.file) || match.file,
          ...(match.projectId ? { projectId: match.projectId } : {}),
          projectRoot:
            path.relative(workspaceRootAbs, match.projectRootAbs) || match.projectRootAbs,
        }));

        if (matches.length > 1) {
          const structuredContent = {
            resultType: "disambiguation",
            status: "class_ambiguous",
            workspaceRoot: workspaceRootAbs,
            hints: { classHint, serviceHint, projectId },
            scannedJavaFiles,
            projectResolution,
            matches,
            nextAction:
              "Refine classHint to exact FQCN or provide projectId/serviceHint to resolve a single class.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
          };
        }

        const selected = chosenMatches[0]!;
        const structuredContent = {
          resultType: "class_methods",
          status: "ok",
          workspaceRoot: workspaceRootAbs,
          hints: { classHint, serviceHint, projectId },
          scannedJavaFiles,
          projectResolution,
          class: {
            className: selected.className,
            ...(selected.fqcn ? { fqcn: selected.fqcn } : {}),
            file: path.relative(workspaceRootAbs, selected.file) || selected.file,
            ...(selected.projectId ? { projectId: selected.projectId } : {}),
            projectRoot:
              path.relative(workspaceRootAbs, selected.projectRootAbs) || selected.projectRootAbs,
          },
          methods: selected.methods,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const resolution = await resolveProjectForInference(
        {
          workspaceRootAbs,
          projects,
          ...(classHint ? { classHint } : {}),
          ...(methodHint ? { methodHint } : {}),
          ...(typeof lineHint === "number" ? { lineHint } : {}),
          ...(serviceHint ? { serviceHint } : {}),
          ...(projectId ? { projectId } : {}),
          maxCandidates: clampInt(maxCandidates ?? 8, 1, 20),
        },
        { inferTargetsFn: inferTargets },
      );

      if (resolution.kind === "selector_not_found") {
        const structuredContent = {
          resultType: "report",
          status: "project_resolution_failed",
          workspaceRoot: resolution.workspaceRootAbs,
          hints: { classHint, methodHint, lineHint, serviceHint, projectId },
          projectResolution: {
            mode: resolution.resolutionMode,
            selectorValue: resolution.selectorValue,
            availableProjects: resolution.availableProjects.map((p) => ({
              id: p.id,
              root: p.rootAbs,
            })),
          },
          nextAction: resolution.nextAction,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const structuredContent = {
        workspaceRoot: resolution.workspaceRootAbs,
        hints: { classHint, methodHint, lineHint, serviceHint, projectId },
        scannedJavaFiles:
          resolution.kind === "cross_project_inference" ? resolution.scannedJavaFiles : undefined,
        ...(resolution.kind === "resolved_project"
          ? { projectRoot: resolution.projectRootAbs }
          : {}),
        projectResolution:
          resolution.kind === "resolved_project"
            ? {
                mode: resolution.resolutionMode,
                ...(resolution.projectId ? { selectedProjectId: resolution.projectId } : {}),
                selectedProjectRoot: resolution.projectRootAbs,
              }
            : {
                mode: resolution.resolutionMode,
                topConfidence: resolution.topConfidence,
                topProjectIds: resolution.topProjectIds,
                isAmbiguous: resolution.isAmbiguous,
                ...(resolution.selectedProjectId
                  ? {
                      selectedProjectId: resolution.selectedProjectId,
                      selectedProjectRoot: resolution.selectedProjectRootAbs,
                    }
                  : {}),
              },
        candidates:
          resolution.kind === "resolved_project"
            ? (
                await inferTargets({
                  rootAbs: resolution.projectRootAbs,
                  maxCandidates: clampInt(maxCandidates ?? 8, 1, 20),
                  ...(classHint ? { classHint } : {}),
                  ...(methodHint ? { methodHint } : {}),
                  ...(typeof lineHint === "number" ? { lineHint } : {}),
                })
              ).candidates.map((c) => ({
                ...c,
                file: path.relative(resolution.workspaceRootAbs, c.file) || c.file,
                ...(resolution.projectId ? { projectId: resolution.projectId } : {}),
                projectRoot:
                  path.relative(resolution.workspaceRootAbs, resolution.projectRootAbs) ||
                  resolution.projectRootAbs,
              }))
            : resolution.candidates.map((c) => ({
                ...c,
                file: path.relative(resolution.workspaceRootAbs, c.file) || c.file,
                projectRoot:
                  path.relative(resolution.workspaceRootAbs, c.projectRootAbs) || c.projectRootAbs,
              })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );
}
