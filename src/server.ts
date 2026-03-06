#!/usr/bin/env node
import * as path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnvAndArgs } from "./config/server-config";
import { CONFIG_DEFAULTS } from "./config/defaults";
import { renderRecipeTemplate } from "./lib/recipe_template";
import { buildRecipeTemplateModel } from "./models/recipe_output_model";
import {
  ProbeDiagnoseInputSchema,
  ProbeActuateInputSchema,
  ProbeResetInputSchema,
  ProbeStatusInputSchema,
  ProbeWaitHitInputSchema,
  ProjectsDiscoverInputSchema,
  RecipeGenerateInputSchema,
  TargetInferInputSchema,
} from "./models/inputs";
import { clampInt } from "./lib/safety";
import { discoverProjects } from "./tools/projects_discover";
import { probeDiagnose } from "./tools/probe_diagnose";
import { generateRecipe } from "./tools/recipe_generate";
import { inferTargets, discoverClassMethods } from "./tools/target_infer";
import { probeReset, probeActuate, probeStatus, probeWaitHit } from "./tools/probe";
import { buildRoutingContext, resolveSelectedMode } from "./utils/recipe_intent_routing.util";
import { resolveProjectForInference } from "./utils/project_resolution.util";

async function main() {
  const cfg = loadConfigFromEnvAndArgs(process.argv);
  const SERVER_REPO_ROOT_ABS = path.resolve(__dirname, "..");
  const PROBE_STATUS_PATH = cfg.probeStatusPath;
  const PROBE_RESET_PATH = cfg.probeResetPath;
  const PROBE_ACTUATE_PATH = CONFIG_DEFAULTS.PROBE_ACTUATE_PATH;

  const server = new McpServer({
    name: "mcp-jvm-debugger",
    version: "0.1.0",
  });

  // Cache discovery results; refreshable by calling projects_discover again.
  // Important: keep startup fast; do discovery lazily (large workspaces can be slow to scan).
  let discoveredProjects: Awaited<ReturnType<typeof discoverProjects>> = [];
  let lastDiscoveryRootAbs = cfg.workspaceRootAbs;
  let hasExplicitDiscovery = false;

  async function ensureProjects(
    rootAbs: string,
  ): Promise<Awaited<ReturnType<typeof discoverProjects>>> {
    if (discoveredProjects.length === 0 || lastDiscoveryRootAbs !== rootAbs) {
      discoveredProjects = await discoverProjects(rootAbs, 100, 300);
      lastDiscoveryRootAbs = rootAbs;
    }
    return discoveredProjects;
  }

  function isLikelyServerRepoRoot(rootAbs: string): boolean {
    return path.resolve(rootAbs) === SERVER_REPO_ROOT_ABS;
  }

  // Register at least one resource so Codex doesn't spam resources/list with "method not found".
  server.registerResource(
    "status",
    "mcp-jvm-debugger://status",
    { mimeType: "application/json", description: "Server status and defaults" },
    async () => {
      const payload = {
        ok: true,
        name: "mcp-jvm-debugger",
        version: "0.1.0",
        workspaceRoot: cfg.workspaceRootAbs,
        workspaceRootSource: cfg.workspaceRootSource,
        probe: {
          baseUrl: cfg.probeBaseUrl,
          statusPath: PROBE_STATUS_PATH,
          resetPath: PROBE_RESET_PATH,
          actuatePath: PROBE_ACTUATE_PATH,
          waitMaxRetriesDefault: cfg.probeWaitMaxRetries,
          waitUnreachableRetryEnabled: cfg.probeWaitUnreachableRetryEnabled,
          waitUnreachableMaxRetries: cfg.probeWaitUnreachableMaxRetries,
        },
        recipe: {
          hasCustomTemplate: false,
        },
        auth: {
          loginDiscoveryEnabled: cfg.authLoginDiscoveryEnabled,
          credentialDiscovery: "disabled",
        },
        time: new Date().toISOString(),
      };
      return {
        contents: [
          {
            uri: "mcp-jvm-debugger://status",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "debug_ping",
    {
      description: "Sanity check: confirms the MCP server is reachable.",
      inputSchema: {},
    },
    async () => {
      const structuredContent = {
        ok: true,
        serverTime: new Date().toISOString(),
        version: "0.1.0",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "projects_discover",
    {
      description:
        "Discover Maven/Gradle Java projects under the workspace root (pom.xml / build.gradle*) and infer probe include scope from Java package declarations.",
      inputSchema: ProjectsDiscoverInputSchema,
    },
    async ({ workspaceRoot, maxProjects, maxJavaFilesPerProject }) => {
      const hasWorkspaceOverride =
        typeof workspaceRoot === "string" && workspaceRoot.trim().length > 0;
      const rootAbs = path.resolve(hasWorkspaceOverride ? workspaceRoot : cfg.workspaceRootAbs);
      const usingImplicitServerDefault =
        !hasWorkspaceOverride &&
        cfg.workspaceRootSource !== "arg" &&
        cfg.workspaceRootSource !== "env";
      if (usingImplicitServerDefault && isLikelyServerRepoRoot(rootAbs)) {
        hasExplicitDiscovery = false;
        discoveredProjects = [];
        const structuredContent = {
          resultType: "report",
          status: "workspace_root_required",
          workspaceRoot: rootAbs,
          workspaceRootSource: cfg.workspaceRootSource,
          warning:
            "Resolved workspace points to the mcp-jvm-debugger tool repository, which is likely not your active project workspace.",
          nextAction:
            "Call projects_discover again with workspaceRoot=<active project root>, or set MCP_WORKSPACE_ROOT explicitly.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const limit = clampInt(maxProjects ?? 50, 1, 200);
      const javaFileLimit = clampInt(maxJavaFilesPerProject ?? 300, 10, 2_000);
      discoveredProjects = await discoverProjects(rootAbs, limit, javaFileLimit);
      lastDiscoveryRootAbs = rootAbs;
      hasExplicitDiscovery = true;

      const defaultProjectId =
        discoveredProjects.length === 1 ? discoveredProjects.at(0)!.id : undefined;
      const structuredContent = {
        workspaceRoot: rootAbs,
        maxJavaFilesPerProject: javaFileLimit,
        defaultProjectId,
        projects: discoveredProjects.map((p) => ({
          id: p.id,
          root: p.rootAbs,
          build: p.build,
          markers: p.markers,
          probeScope: p.probeScope,
        })),
      };

      const lines: string[] = [];
      lines.push(`workspaceRoot=${rootAbs}`);
      if (defaultProjectId) lines.push(`defaultProjectId=${defaultProjectId}`);
      lines.push(`maxJavaFilesPerProject=${javaFileLimit}`);
      lines.push("projects:");
      for (const p of discoveredProjects) {
        lines.push(`  - id=${p.id} build=${p.build} root=${p.rootAbs}`);
        lines.push(`    probeIncludeSuggested=${p.probeScope.suggestedInclude ?? "(none)"}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "probe_diagnose",
    {
      description:
        "Diagnose probe wiring quickly: reset/status reachability, key decoding health, and actionable next steps.",
      inputSchema: ProbeDiagnoseInputSchema,
    },
    async ({ baseUrl, timeoutMs }) => {
      const diagnoseArgs: Parameters<typeof probeDiagnose>[0] = {
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        statusPath: PROBE_STATUS_PATH,
        resetPath: PROBE_RESET_PATH,
      };
      if (typeof timeoutMs === "number") diagnoseArgs.timeoutMs = timeoutMs;
      return await probeDiagnose(diagnoseArgs);
    },
  );

  server.registerTool(
    "target_infer",
    {
      description:
        "Infer runtime probe keys (ranked_candidates mode) or return deterministic class method inventory with line spans (class_methods mode).",
      inputSchema: TargetInferInputSchema,
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
      if (!hasExplicitDiscovery && (!workspaceRoot || workspaceRoot.trim().length === 0)) {
        const structuredContent = {
          resultType: "report",
          status: "workspace_discovery_required",
          nextAction:
            "Call projects_discover first (preferably with workspaceRoot set to the active project root), then rerun target_infer.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const workspaceRootAbs = path.resolve(workspaceRoot ?? cfg.workspaceRootAbs);
      const projects = await ensureProjects(workspaceRootAbs);
      const selectedDiscoveryMode = discoveryMode ?? "ranked_candidates";

      if (selectedDiscoveryMode === "class_methods") {
        const classHintTrimmed = classHint?.trim();
        if (!classHintTrimmed) {
          const structuredContent = {
            resultType: "report",
            status: "class_hint_required",
            workspaceRoot: workspaceRootAbs,
            nextAction:
              "Provide classHint and rerun target_infer with discoveryMode=class_methods.",
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
                "Provide a valid projectId from projects_discover, or omit projectId to allow wider class discovery.",
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
                "Provide a valid serviceHint from projects_discover, or omit serviceHint to allow wider class discovery.",
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
              "Refine classHint (prefer exact class name or fully qualified class name) and rerun target_infer.",
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

  server.registerTool(
    "recipe_generate",
    {
      description:
        "Generate a reproducible request recipe for hitting a target method, inferred from code hints and optional local OpenAPI schema files. Includes auth/login hints when available.",
      inputSchema: RecipeGenerateInputSchema,
    },
    async ({
      classHint,
      methodHint,
      lineHint,
      intentMode,
      serviceHint,
      projectId,
      workspaceRoot,
      authToken,
      authUsername,
      authPassword,
      actuationEnabled,
      actuationReturnBoolean,
      actuationActuatorId,
      outputTemplate,
    }) => {
      if (!hasExplicitDiscovery && (!workspaceRoot || workspaceRoot.trim().length === 0)) {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "projects_discover_required",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
          nextAction:
            "Call projects_discover first, then rerun recipe_generate. Discovery is required before endpoint/route inference.",
          notes: [
            "recipe_generate is blocked until projects_discover is completed at least once.",
            "This guard prevents endpoint guessing and reduces false negatives from wrong base/context paths.",
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const workspaceRootAbs = path.resolve(workspaceRoot ?? cfg.workspaceRootAbs);
      const projects = await ensureProjects(workspaceRootAbs);
      // Future runtime-assisted issue can extend the agent/MCP contract with service/class identity.
      // For now, project selection remains repo-side and uses discovered projects plus source inference.
      const resolution = await resolveProjectForInference(
        {
          workspaceRootAbs,
          projects,
          classHint,
          methodHint,
          ...(typeof lineHint === "number" ? { lineHint } : {}),
          ...(serviceHint ? { serviceHint } : {}),
          ...(projectId ? { projectId } : {}),
        },
        { inferTargetsFn: inferTargets },
      );
      if (resolution.kind === "selector_not_found") {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "project_resolution_failed",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
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
      if (resolution.kind === "cross_project_inference" && resolution.isAmbiguous) {
        const routingDecision = resolveSelectedMode(
          buildRoutingContext({
            intentMode,
            ...(typeof lineHint === "number" ? { lineHint } : {}),
          }),
        );
        const structuredContent = {
          resultType: "report",
          status: "ambiguous_project_match",
          selectedMode: routingDecision.selectedMode,
          ...(routingDecision.downgradedFrom
            ? { downgradedFrom: routingDecision.downgradedFrom }
            : {}),
          ...(routingDecision.routingNote ? { routingNote: routingDecision.routingNote } : {}),
          workspaceRoot: resolution.workspaceRootAbs,
          hints: { classHint, methodHint, lineHint, serviceHint, projectId },
          scannedJavaFiles: resolution.scannedJavaFiles,
          projectResolution: {
            mode: resolution.resolutionMode,
            topConfidence: resolution.topConfidence,
            topProjectIds: resolution.topProjectIds,
            isAmbiguous: true,
          },
          candidates: resolution.candidates.map((c) => ({
            ...c,
            file: path.relative(resolution.workspaceRootAbs, c.file) || c.file,
            projectRoot:
              path.relative(resolution.workspaceRootAbs, c.projectRootAbs) || c.projectRootAbs,
          })),
          nextAction:
            "Provide projectId or serviceHint to disambiguate the target project, then rerun recipe_generate.",
          notes: [
            "Multiple discovered projects produced equally strong top target matches.",
            "Automatic project selection is blocked to avoid generating a recipe for the wrong service.",
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }
      const resolvedProject =
        resolution.kind === "resolved_project"
          ? resolution
          : {
              workspaceRootAbs: resolution.workspaceRootAbs,
              projectRootAbs: resolution.selectedProjectRootAbs ?? resolution.workspaceRootAbs,
              projectId: resolution.selectedProjectId,
              resolutionMode: resolution.resolutionMode,
            };

      const generateArgs: Parameters<typeof generateRecipe>[0] = {
        rootAbs: resolvedProject.projectRootAbs,
        workspaceRootAbs: resolvedProject.workspaceRootAbs,
        classHint,
        methodHint,
        intentMode,
        authLoginDiscoveryEnabled: cfg.authLoginDiscoveryEnabled,
      };
      if (typeof lineHint === "number") generateArgs.lineHint = lineHint;
      if (authToken) generateArgs.authToken = authToken;
      if (authUsername) generateArgs.authUsername = authUsername;
      if (authPassword) generateArgs.authPassword = authPassword;
      if (typeof actuationEnabled === "boolean") generateArgs.actuationEnabled = actuationEnabled;
      if (typeof actuationReturnBoolean === "boolean") {
        generateArgs.actuationReturnBoolean = actuationReturnBoolean;
      }
      if (actuationActuatorId) generateArgs.actuationActuatorId = actuationActuatorId;
      const generated = await generateRecipe(generateArgs);
      const modelArgs: Parameters<typeof buildRecipeTemplateModel>[0] = {
        classHint,
        methodHint,
        generated,
      };
      if (typeof lineHint === "number") modelArgs.lineHint = lineHint;
      const model = buildRecipeTemplateModel(modelArgs);
      const hasExplicitTemplate =
        typeof outputTemplate === "string" && outputTemplate.trim().length > 0;
      const template = hasExplicitTemplate ? outputTemplate : undefined;
      const rendered = template ? renderRecipeTemplate(template, model) : undefined;

      const structuredContent = {
        workspaceRoot: resolvedProject.workspaceRootAbs,
        projectRoot: resolvedProject.projectRootAbs,
        hints: {
          classHint,
          methodHint,
          lineHint,
          serviceHint,
          projectId,
          actuationEnabled,
          actuationReturnBoolean,
          actuationActuatorId,
        },
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
                isAmbiguous: false,
                ...(resolution.selectedProjectId
                  ? {
                      selectedProjectId: resolution.selectedProjectId,
                      selectedProjectRoot: resolution.selectedProjectRootAbs,
                    }
                  : {}),
              },
        inferredTarget: generated.inferredTarget
          ? {
              ...generated.inferredTarget,
              file: path.relative(resolvedProject.workspaceRootAbs, generated.inferredTarget.file),
            }
          : undefined,
        requestCandidates: generated.requestCandidates,
        executionPlan: generated.executionPlan,
        resultType: generated.resultType,
        status: generated.status,
        selectedMode: generated.selectedMode,
        ...(generated.downgradedFrom ? { downgradedFrom: generated.downgradedFrom } : {}),
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.routingNote ? { routingNote: generated.routingNote } : {}),
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        inferenceDiagnostics: generated.inferenceDiagnostics,
        auth: generated.auth,
        notes: generated.notes,
        ...(rendered ? { rendered } : {}),
      };
      const internalContent = {
        resultType: generated.resultType,
        status: generated.status,
        selectedMode: generated.selectedMode,
        ...(generated.downgradedFrom ? { downgradedFrom: generated.downgradedFrom } : {}),
        lineTargetProvided: generated.lineTargetProvided,
        probeIntentRequested: generated.probeIntentRequested,
        executionReadiness: generated.executionReadiness,
        missingInputs: generated.missingInputs,
        ...(generated.routingNote ? { routingNote: generated.routingNote } : {}),
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        ...(generated.failurePhase ? { failurePhase: generated.failurePhase } : {}),
        ...(generated.failureReasonCode ? { failureReasonCode: generated.failureReasonCode } : {}),
        inferenceDiagnostics: generated.inferenceDiagnostics,
        routingReason: generated.executionPlan.routingReason,
        inferredTarget: structuredContent.inferredTarget,
        requestCandidates: generated.requestCandidates,
        executionPlan: generated.executionPlan,
        auth: generated.auth,
        notes: generated.notes,
      };
      return {
        content: [
          {
            type: "text",
            text: rendered ?? JSON.stringify(internalContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "probe_actuate",
    {
      description:
        "Dynamically arm/disarm line-branch actuation without JVM restart. In actuate mode, targetKey must be fully.qualified.Class#method:line and returnBoolean controls branch decision (true=taken, false=fallthrough). Use mode=observe to disarm.",
      inputSchema: ProbeActuateInputSchema,
    },
    async ({ baseUrl, mode, actuatorId, targetKey, returnBoolean, timeoutMs }) => {
      const args: Parameters<typeof probeActuate>[0] = {
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        actuatePath: PROBE_ACTUATE_PATH,
      };
      if (typeof mode === "string") args.mode = mode;
      if (typeof actuatorId === "string") args.actuatorId = actuatorId;
      if (typeof targetKey === "string") args.targetKey = targetKey;
      if (typeof returnBoolean === "boolean") args.returnBoolean = returnBoolean;
      if (typeof timeoutMs === "number") args.timeoutMs = timeoutMs;
      return await probeActuate(args);
    },
  );

  server.registerTool(
    "probe_status",
    {
      description:
        "Query line-level probe status for one key (`key`) or many keys (`keys`). Keys must be fully.qualified.Class#method:line in strict line mode.",
      inputSchema: ProbeStatusInputSchema,
    },
    async ({ key, keys, lineHint, baseUrl, timeoutMs }) => {
      const args: Parameters<typeof probeStatus>[0] = {
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        statusPath: PROBE_STATUS_PATH,
      };
      if (typeof key === "string") args.key = key;
      if (Array.isArray(keys)) args.keys = keys;
      if (typeof lineHint === "number") args.lineHint = lineHint;
      if (typeof timeoutMs !== "undefined") args.timeoutMs = timeoutMs;
      return await probeStatus(args);
    },
  );

  server.registerTool(
    "probe_reset",
    {
      description:
        "Reset probe counter/state for one key (`key`), many keys (`keys`), or all known line keys for a class (`className`).",
      inputSchema: ProbeResetInputSchema,
    },
    async ({ key, keys, className, lineHint, baseUrl, timeoutMs }) => {
      const args: Parameters<typeof probeReset>[0] = {
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        resetPath: PROBE_RESET_PATH,
      };
      if (typeof key === "string") args.key = key;
      if (Array.isArray(keys)) args.keys = keys;
      if (typeof className === "string") args.className = className;
      if (typeof lineHint === "number") args.lineHint = lineHint;
      if (typeof timeoutMs !== "undefined") args.timeoutMs = timeoutMs;
      return await probeReset(args);
    },
  );

  server.registerTool(
    "probe_wait_hit",
    {
      description:
        "Poll probe_status until an inline line hit is observed for key fully.qualified.Class#method:line. Method-only keys are rejected in strict line mode.",
      inputSchema: ProbeWaitHitInputSchema,
    },
    async ({ key, lineHint, baseUrl, timeoutMs, pollIntervalMs, maxRetries }) => {
      const args: Parameters<typeof probeWaitHit>[0] = {
        key,
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        statusPath: PROBE_STATUS_PATH,
      };
      if (typeof lineHint === "number") args.lineHint = lineHint;
      if (typeof timeoutMs !== "undefined") args.timeoutMs = timeoutMs;
      if (typeof pollIntervalMs !== "undefined") args.pollIntervalMs = pollIntervalMs;
      args.maxRetries = typeof maxRetries === "number" ? maxRetries : cfg.probeWaitMaxRetries;
      args.unreachableRetryEnabled = cfg.probeWaitUnreachableRetryEnabled;
      args.unreachableMaxRetries = cfg.probeWaitUnreachableMaxRetries;
      return await probeWaitHit(args);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-jvm-debugger 0.1.0 running (stdio). workspaceRoot=${cfg.workspaceRootAbs} probeBaseUrl=${cfg.probeBaseUrl}`,
  );
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
