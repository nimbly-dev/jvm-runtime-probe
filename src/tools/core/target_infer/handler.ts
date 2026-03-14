import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServerConfig } from "@/config/server-config";
import { clampInt } from "@/lib/safety";
import { validateProjectRootAbs } from "@/utils/project_root_validate.util";
import {
  RuntimeProbeUnreachableError,
  selectRuntimeValidatedLine,
} from "@/utils/inference/runtime_line_selection.util";
import { discoverClassMethods, inferTargets } from "@/tools/core/target_infer/domain";
import { TARGET_INFER_TOOL } from "@/tools/core/target_infer/contract";

export type TargetInferHandlerDeps = {
  config: ServerConfig;
};

function runtimeUnavailableResponse(args: {
  rootAbs: string;
  hints: Record<string, unknown>;
  reason: string;
}) {
  const structuredContent = {
    resultType: "report",
    status: "runtime_unreachable",
    reasonCode: "runtime_unreachable",
    failedStep: "line_validation",
    projectRoot: args.rootAbs,
    hints: args.hints,
    reason: args.reason,
    nextAction:
      "Verify probe runtime reachability (probe base URL/port) and rerun probe_target_infer.",
    evidence: [args.reason],
    attemptedStrategies: ["runtime_line_validation"],
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function registerTargetInferTool(server: McpServer, deps: TargetInferHandlerDeps): void {
  const deprecatedSelectorKeys = ["serviceHint", "projectId", "workspaceRoot"] as const;
  const selectLine = async (args: {
    probeKey?: string;
    startLine: number;
    endLine: number;
  }): Promise<{
    firstExecutableLine: number | null;
    lineSelectionStatus: "validated" | "unresolved";
    lineSelectionSource?: "runtime_probe_validation";
  }> => {
    if (!args.probeKey) {
      return {
        firstExecutableLine: null,
        lineSelectionStatus: "unresolved",
      };
    }
    if (!deps.config.probeBaseUrl || !deps.config.probeStatusPath) {
      throw new RuntimeProbeUnreachableError(
        "Probe runtime config unavailable (missing probeBaseUrl/probeStatusPath).",
      );
    }
    return await selectRuntimeValidatedLine({
      probeBaseUrl: deps.config.probeBaseUrl,
      probeStatusPath: deps.config.probeStatusPath,
      probeKey: args.probeKey,
      startLine: args.startLine,
      endLine: args.endLine,
      maxScanLines: deps.config.probeLineSelectionMaxScanLines,
    });
  };
  server.registerTool(
    TARGET_INFER_TOOL.name,
    {
      description: TARGET_INFER_TOOL.description,
      inputSchema: TARGET_INFER_TOOL.inputSchema,
    },
    async (input) => {
      const deprecatedUsed = deprecatedSelectorKeys.filter(
        (key) => key in (input as Record<string, unknown>),
      );
      if (deprecatedUsed.length > 0) {
        const structuredContent = {
          resultType: "report",
          status: "project_selector_invalid",
          reason: `Unsupported selector inputs: ${deprecatedUsed.join(", ")}`,
          nextAction:
            "Remove legacy selector fields and provide only projectRootAbs as the project selector.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const { projectRootAbs, discoveryMode, classHint, methodHint, lineHint, maxCandidates } =
        input;
      const validated = await validateProjectRootAbs(projectRootAbs);
      if (!validated.ok) {
        const structuredContent = {
          resultType: "report",
          status: validated.status,
          reason: validated.reason,
          ...(validated.value ? { projectRootAbs: validated.value } : {}),
          nextAction: validated.nextAction,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const rootAbs = validated.projectRootAbs;
      const selectedDiscoveryMode = discoveryMode ?? "ranked_candidates";

      if (selectedDiscoveryMode === "class_methods") {
        const classHintTrimmed = classHint?.trim();
        if (!classHintTrimmed) {
          const structuredContent = {
            resultType: "report",
            status: "class_hint_required",
            projectRoot: rootAbs,
            nextAction:
              "Provide classHint and rerun probe_target_infer with discoveryMode=class_methods.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
          };
        }

        const discovered = await discoverClassMethods({
          rootAbs,
          classHint: classHintTrimmed,
        });
        const chosenMatches = discovered.classes;

        if (chosenMatches.length === 0) {
          const structuredContent = {
            resultType: "class_methods",
            status: "class_not_found",
            projectRoot: rootAbs,
            hints: { projectRootAbs: rootAbs, classHint },
            scannedJavaFiles: discovered.scannedJavaFiles,
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
          file: path.relative(rootAbs, match.file) || match.file,
        }));

        if (matches.length > 1) {
          const structuredContent = {
            resultType: "disambiguation",
            status: "class_ambiguous",
            projectRoot: rootAbs,
            hints: { projectRootAbs: rootAbs, classHint },
            scannedJavaFiles: discovered.scannedJavaFiles,
            matches,
            nextAction: "Refine classHint to exact FQCN to resolve a single class.",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
          };
        }

        const selected = chosenMatches[0]!;
        const validatedMethods: typeof selected.methods = [];
        try {
          for (const method of selected.methods) {
            const runtimeSelection = await selectLine({
              ...(method.probeKey ? { probeKey: method.probeKey } : {}),
              startLine: method.startLine,
              endLine: method.endLine,
            });
            validatedMethods.push({
              ...method,
              firstExecutableLine: runtimeSelection.firstExecutableLine,
              lineSelectionStatus: runtimeSelection.lineSelectionStatus,
              ...(runtimeSelection.lineSelectionSource
                ? { lineSelectionSource: runtimeSelection.lineSelectionSource }
                : {}),
            });
          }
        } catch (err) {
          if (err instanceof RuntimeProbeUnreachableError) {
            return runtimeUnavailableResponse({
              rootAbs,
              hints: { projectRootAbs: rootAbs, classHint, discoveryMode: selectedDiscoveryMode },
              reason: err.message,
            });
          }
          throw err;
        }

        const structuredContent = {
          resultType: "class_methods",
          status: "ok",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint },
          scannedJavaFiles: discovered.scannedJavaFiles,
          class: {
            className: selected.className,
            ...(selected.fqcn ? { fqcn: selected.fqcn } : {}),
            file: path.relative(rootAbs, selected.file) || selected.file,
          },
          methods: validatedMethods,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      if (!classHint?.trim()) {
        const structuredContent = {
          resultType: "report",
          status: "class_hint_required",
          reasonCode: "class_hint_required",
          failedStep: "input_validation",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
          reason: "ranked_candidates requires exact classHint for deterministic target selection.",
          nextAction:
            "Provide classHint as exact FQCN (preferred) or exact class name, then rerun probe_target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const inferred = await inferTargets({
        rootAbs,
        maxCandidates: clampInt(maxCandidates ?? 8, 1, 20),
        ...(classHint ? { classHint } : {}),
        ...(methodHint ? { methodHint } : {}),
        ...(typeof lineHint === "number" ? { lineHint } : {}),
      });

      if (inferred.candidates.length === 0) {
        const structuredContent = {
          resultType: "report",
          status: "target_not_found",
          reasonCode: "target_not_found",
          failedStep: "target_inference",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
          scannedJavaFiles: inferred.scannedJavaFiles,
          nextAction:
            "Refine classHint/methodHint to exact runtime identifiers and rerun probe_target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const validatedCandidates = [] as typeof inferred.candidates;
      try {
        for (const candidate of inferred.candidates) {
          const runtimeSelection = await selectLine({
            ...(candidate.key ? { probeKey: candidate.key } : {}),
            startLine:
              typeof candidate.declarationLine === "number"
                ? candidate.declarationLine
                : typeof candidate.line === "number"
                  ? candidate.line
                  : 1,
            endLine:
              typeof candidate.endLine === "number"
                ? candidate.endLine
                : typeof candidate.declarationLine === "number"
                  ? candidate.declarationLine
                  : typeof candidate.line === "number"
                    ? candidate.line
                    : 1,
          });
          validatedCandidates.push({
            ...candidate,
            line: runtimeSelection.firstExecutableLine,
            firstExecutableLine: runtimeSelection.firstExecutableLine,
            lineSelectionStatus: runtimeSelection.lineSelectionStatus,
            ...(runtimeSelection.lineSelectionSource
              ? { lineSelectionSource: runtimeSelection.lineSelectionSource }
              : {}),
          });
        }
      } catch (err) {
        if (err instanceof RuntimeProbeUnreachableError) {
          return runtimeUnavailableResponse({
            rootAbs,
            hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
            reason: err.message,
          });
        }
        throw err;
      }

      const runtimeResolvedCandidates = validatedCandidates.filter(
        (candidate) =>
          candidate.lineSelectionStatus === "validated" && typeof candidate.line === "number",
      );
      if (runtimeResolvedCandidates.length === 0) {
        const structuredContent = {
          resultType: "report",
          status: "target_not_found",
          reasonCode: "runtime_line_unresolved",
          failedStep: "line_validation",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
          scannedJavaFiles: inferred.scannedJavaFiles,
          evidence: [
            `candidateCount=${validatedCandidates.length}`,
            `maxScanLines=${deps.config.probeLineSelectionMaxScanLines}`,
          ],
          attemptedStrategies: ["target_inference_exact_match", "runtime_line_validation"],
          nextAction:
            "No runtime-resolvable line was found for inferred candidates. Verify runtime/source alignment and rerun probe_target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const lineMatches =
        typeof lineHint === "number"
          ? runtimeResolvedCandidates.filter((candidate) => candidate.line === lineHint)
          : [];
      if (typeof lineHint === "number" && lineMatches.length === 0) {
        const structuredContent = {
          resultType: "report",
          status: "target_not_found",
          reasonCode: "line_hint_not_resolvable",
          failedStep: "line_validation",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
          scannedJavaFiles: inferred.scannedJavaFiles,
          evidence: [
            `lineHint=${lineHint}`,
            `resolvedCandidateCount=${runtimeResolvedCandidates.length}`,
          ],
          attemptedStrategies: ["target_inference_exact_match", "runtime_line_validation"],
          nextAction:
            "Provided lineHint is not runtime-resolvable for inferred candidates. Use class_methods output to select a validated line and rerun.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const selectedCandidates =
        typeof lineHint === "number" ? lineMatches : runtimeResolvedCandidates;

      if (selectedCandidates.length > 1) {
        const structuredContent = {
          resultType: "disambiguation",
          status: "target_ambiguous",
          reasonCode: "target_ambiguous",
          failedStep: "target_selection",
          projectRoot: rootAbs,
          hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
          scannedJavaFiles: inferred.scannedJavaFiles,
          matches: selectedCandidates.map((candidate) => ({
            ...candidate,
            file: path.relative(rootAbs, candidate.file) || candidate.file,
          })),
          nextAction:
            "Refine classHint to exact FQCN and methodHint to exact method name (add lineHint only when strict line disambiguation is known), then rerun probe_target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const structuredContent = {
        resultType: "ranked_candidates",
        status: "ok",
        projectRoot: rootAbs,
        hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
        scannedJavaFiles: inferred.scannedJavaFiles,
        candidates: selectedCandidates.map((c) => ({
          ...c,
          file: path.relative(rootAbs, c.file) || c.file,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );
}
