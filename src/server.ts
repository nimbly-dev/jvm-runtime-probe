#!/usr/bin/env node
import * as path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnvAndArgs } from "./config/server-config";
import { CONFIG_DEFAULTS } from "./config/defaults";
import {
  renderRecipeTemplate,
} from "./lib/recipe_template";
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
import { inferTargets } from "./tools/target_infer";
import {
  probeReset,
  probeActuate,
  probeStatus,
  probeWaitHit,
} from "./tools/probe";

async function main() {
  const cfg = loadConfigFromEnvAndArgs(process.argv);
  const SERVER_REPO_ROOT_ABS = path.resolve(__dirname, "..");
  const PROBE_STATUS_PATH = CONFIG_DEFAULTS.PROBE_STATUS_PATH;
  const PROBE_RESET_PATH = CONFIG_DEFAULTS.PROBE_RESET_PATH;
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

  async function ensureProjects(rootAbs: string): Promise<Awaited<ReturnType<typeof discoverProjects>>> {
    if (discoveredProjects.length === 0 || lastDiscoveryRootAbs !== rootAbs) {
      discoveredProjects = await discoverProjects(rootAbs, 100, 300);
      lastDiscoveryRootAbs = rootAbs;
    }
    return discoveredProjects;
  }

  function isLikelyServerRepoRoot(rootAbs: string): boolean {
    return path.resolve(rootAbs) === SERVER_REPO_ROOT_ABS;
  }

  async function resolveProjectRoot(args: {
    workspaceRoot?: string;
    projectId?: string;
    serviceHint?: string;
  }): Promise<{ workspaceRootAbs: string; projectRootAbs: string }> {
    const workspaceRootAbs = path.resolve(args.workspaceRoot ?? cfg.workspaceRootAbs);
    const projects = await ensureProjects(workspaceRootAbs);
    if (projects.length === 0) {
      return { workspaceRootAbs, projectRootAbs: workspaceRootAbs };
    }

    if (args.projectId) {
      const found = projects.find((p) => p.id === args.projectId);
      if (found) return { workspaceRootAbs, projectRootAbs: found.rootAbs };
    }

    if (args.serviceHint) {
      const needle = args.serviceHint.toLowerCase();
      const found = projects.find((p) => p.rootAbs.toLowerCase().includes(needle));
      if (found) return { workspaceRootAbs, projectRootAbs: found.rootAbs };
    }

    if (projects.length === 1) {
      return { workspaceRootAbs, projectRootAbs: projects[0]!.rootAbs };
    }

    return { workspaceRootAbs, projectRootAbs: projects[0]!.rootAbs };
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
        },
        recipe: {
          hasCustomTemplate: Boolean(cfg.recipeOutputTemplate),
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
      const usingImplicitServerDefault = !hasWorkspaceOverride && cfg.workspaceRootSource !== "arg" && cfg.workspaceRootSource !== "env";
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
        lines.push(
          `    probeIncludeSuggested=${p.probeScope.suggestedInclude ?? "(none)"}`,
        );
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
        "Infer likely runtime probe keys (fully.qualified.Class#method) from class/method/line hints in project code.",
      inputSchema: TargetInferInputSchema,
    },
    async ({ classHint, methodHint, lineHint, serviceHint, projectId, workspaceRoot, maxCandidates }) => {
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
      const resolveArgs: Parameters<typeof resolveProjectRoot>[0] = {};
      if (workspaceRoot) resolveArgs.workspaceRoot = workspaceRoot;
      if (projectId) resolveArgs.projectId = projectId;
      if (serviceHint) resolveArgs.serviceHint = serviceHint;
      const resolved = await resolveProjectRoot(resolveArgs);

      const inferArgs: Parameters<typeof inferTargets>[0] = {
        rootAbs: resolved.projectRootAbs,
        maxCandidates: clampInt(maxCandidates ?? 8, 1, 20),
      };
      if (classHint) inferArgs.classHint = classHint;
      if (methodHint) inferArgs.methodHint = methodHint;
      if (typeof lineHint === "number") inferArgs.lineHint = lineHint;
      const inferred = await inferTargets(inferArgs);

      const structuredContent = {
        workspaceRoot: resolved.workspaceRootAbs,
        projectRoot: resolved.projectRootAbs,
        hints: { classHint, methodHint, lineHint, serviceHint, projectId },
        scannedJavaFiles: inferred.scannedJavaFiles,
        candidates: inferred.candidates.map((c) => ({
          ...c,
          file: path.relative(resolved.workspaceRootAbs, c.file) || c.file,
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
      mode,
      serviceHint,
      projectId,
      workspaceRoot,
      authToken,
      authUsername,
      authPassword,
      outputTemplate,
    }) => {
      if (!hasExplicitDiscovery && (!workspaceRoot || workspaceRoot.trim().length === 0)) {
        const structuredContent = {
          resultType: "report",
          status: "unreachable_natural",
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

      const resolveArgs: Parameters<typeof resolveProjectRoot>[0] = {};
      if (workspaceRoot) resolveArgs.workspaceRoot = workspaceRoot;
      if (projectId) resolveArgs.projectId = projectId;
      if (serviceHint) resolveArgs.serviceHint = serviceHint;
      const resolved = await resolveProjectRoot(resolveArgs);

      const generateArgs: Parameters<typeof generateRecipe>[0] = {
        rootAbs: resolved.projectRootAbs,
        workspaceRootAbs: resolved.workspaceRootAbs,
        classHint,
        methodHint,
        ...(mode ? { mode } : {}),
        authLoginDiscoveryEnabled: cfg.authLoginDiscoveryEnabled,
      };
      if (typeof lineHint === "number") generateArgs.lineHint = lineHint;
      if (authToken) generateArgs.authToken = authToken;
      if (authUsername) generateArgs.authUsername = authUsername;
      if (authPassword) generateArgs.authPassword = authPassword;
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
      const rendered = template
        ? renderRecipeTemplate(template, model)
        : undefined;

      const structuredContent = {
        workspaceRoot: resolved.workspaceRootAbs,
        projectRoot: resolved.projectRootAbs,
        hints: { classHint, methodHint, lineHint, serviceHint, projectId },
        inferredTarget: generated.inferredTarget
          ? {
              ...generated.inferredTarget,
              file: path.relative(resolved.workspaceRootAbs, generated.inferredTarget.file),
            }
          : undefined,
        requestCandidates: generated.requestCandidates,
        executionPlan: generated.executionPlan,
        resultType: generated.resultType,
        status: generated.status,
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        auth: generated.auth,
        notes: generated.notes,
        ...(rendered ? { rendered } : {}),
      };
      const internalContent = {
        resultType: generated.resultType,
        status: generated.status,
        ...(generated.nextAction ? { nextAction: generated.nextAction } : {}),
        mode: generated.executionPlan.mode,
        modeReason: generated.executionPlan.modeReason,
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
        "Query line-level probe status for a key (fully.qualified.Class#method:line). Method-only keys are rejected in strict line mode.",
      inputSchema: ProbeStatusInputSchema,
    },
    async ({ key, lineHint, baseUrl, timeoutMs }) => {
      const args: Parameters<typeof probeStatus>[0] = {
        key,
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        statusPath: PROBE_STATUS_PATH,
      };
      if (typeof lineHint === "number") args.lineHint = lineHint;
      if (typeof timeoutMs !== "undefined") args.timeoutMs = timeoutMs;
      return await probeStatus(args);
    },
  );

  server.registerTool(
    "probe_reset",
    {
      description:
        "Reset probe counter/state for a line-level key (fully.qualified.Class#method:line). Method-only keys are rejected in strict line mode.",
      inputSchema: ProbeResetInputSchema,
    },
    async ({ key, lineHint, baseUrl, timeoutMs }) => {
      const args: Parameters<typeof probeReset>[0] = {
        key,
        baseUrl: baseUrl ?? cfg.probeBaseUrl,
        resetPath: PROBE_RESET_PATH,
      };
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
