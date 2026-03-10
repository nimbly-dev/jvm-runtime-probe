import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServerConfig } from "../../../config/server-config";
import { clampInt } from "../../../lib/safety";
import { validateProjectRootAbs } from "../../../utils/project_root_validate.util";
import { discoverClassMethods, inferTargets } from "./domain";
import { TARGET_INFER_TOOL } from "./contract";

export type TargetInferHandlerDeps = {
  config: ServerConfig;
};

export function registerTargetInferTool(server: McpServer, deps: TargetInferHandlerDeps): void {
  const deprecatedSelectorKeys = ["serviceHint", "projectId", "workspaceRoot"] as const;
  void deps;
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
        const chosenMatches =
          discovered.matchMode === "exact" ? discovered.classes : discovered.classes;

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
          methods: selected.methods,
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

      const structuredContent = {
        projectRoot: rootAbs,
        hints: { projectRootAbs: rootAbs, classHint, methodHint, lineHint },
        scannedJavaFiles: inferred.scannedJavaFiles,
        candidates: inferred.candidates.map((c) => ({
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
