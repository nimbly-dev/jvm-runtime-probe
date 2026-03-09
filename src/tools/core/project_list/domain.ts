import * as path from "node:path";

import { clampInt } from "../../../lib/safety";
import type { ServerConfig } from "../../../config/server-config";
import type { ProjectRuntime } from "../../../utils/project_discovery/project_runtime.util";

export type ProjectListDomainDeps = {
  config: ServerConfig;
  serverRepoRootAbs: string;
  projectRuntime: ProjectRuntime;
};

export type ProjectListInput = {
  workspaceRoot?: string | undefined;
  maxProjects?: number | undefined;
  maxJavaFilesPerProject?: number | undefined;
};

export async function listProjectsDomain(
  input: ProjectListInput,
  deps: ProjectListDomainDeps,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}> {
  const hasWorkspaceOverride =
    typeof input.workspaceRoot === "string" && input.workspaceRoot.trim().length > 0;
  const workspaceRootValue = hasWorkspaceOverride
    ? (input.workspaceRoot as string)
    : deps.config.workspaceRootAbs;
  const rootAbs = path.resolve(workspaceRootValue);
  const usingImplicitServerDefault =
    !hasWorkspaceOverride &&
    deps.config.workspaceRootSource !== "arg" &&
    deps.config.workspaceRootSource !== "env";
  if (usingImplicitServerDefault && path.resolve(rootAbs) === deps.serverRepoRootAbs) {
    deps.projectRuntime.resetImplicitDiscovery();
    const structuredContent = {
      resultType: "report",
      status: "workspace_root_required",
      workspaceRoot: rootAbs,
      workspaceRootSource: deps.config.workspaceRootSource,
      warning:
        "Resolved workspace points to the mcp-jvm-debugger tool repository, which is likely not your active project workspace.",
      nextAction:
        "Call project_list again with workspaceRoot=<active project root>, or set MCP_WORKSPACE_ROOT explicitly.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  }

  const limit = clampInt(input.maxProjects ?? 50, 1, 200);
  const javaFileLimit = clampInt(input.maxJavaFilesPerProject ?? 300, 10, 2_000);
  const discoveredProjects = await deps.projectRuntime.discoverExplicit(rootAbs, limit, javaFileLimit);

  const defaultProjectId = discoveredProjects.length === 1 ? discoveredProjects.at(0)!.id : undefined;
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
}
