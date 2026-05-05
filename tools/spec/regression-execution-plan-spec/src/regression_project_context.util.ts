import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { URL } from "node:url";

import type { ProjectRuntimeContext, ProjectWorkspaceEntry } from "@tools-project-artifact-spec/models/project_artifact.model";
import { readProjectArtifact } from "@tools-project-artifact-spec/project_artifact.util";

type ProjectContextBlockedReason =
  | "project_artifact_missing"
  | "project_artifact_invalid"
  | "workspace_root_invalid"
  | "env_key_missing"
  | "runtime_context_unknown"
  | "external_system_invalid"
  | "external_healthcheck_failed";

export type ProjectContextResolutionResult =
  | {
      status: "ok";
      contextPatch: Record<string, unknown>;
      runtimeContextName?: string;
    }
  | {
      status: "blocked";
      reasonCode: ProjectContextBlockedReason;
      missing?: string[];
      checks?: string[];
      nextAction?: string;
      requiredUserAction: string[];
    };

type ResolveProjectContextArgs = {
  workspaceRootAbs: string;
  projectsFileAbs: string;
  env?: Record<string, string | undefined>;
  runtimeContextName?: string;
  healthChecksEnabled?: boolean;
  runtimeStarter?: RuntimeStarter;
};

type RuntimeStartResult = {
  attempted: boolean;
  success: boolean;
  detail?: string;
};

type RuntimeStarter = (args: {
  runtimeContext: ProjectRuntimeContext;
  workspaceRootAbs: string;
}) => Promise<RuntimeStartResult>;

async function tcpCheck(target: string, timeoutMs: number): Promise<boolean> {
  const [host, portStr] = target.split(":");
  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port <= 0) return false;
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => end(false));
    socket.once("error", () => end(false));
    socket.connect(port, host, () => end(true));
  });
}

async function httpCheck(urlRaw: string, method: string, timeoutMs: number, expectStatus?: number): Promise<boolean> {
  try {
    const url = new URL(urlRaw);
    const ctrl = new AbortController();
    const handle = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method, signal: ctrl.signal });
      if (typeof expectStatus === "number") return response.status === expectStatus;
      return response.status >= 200 && response.status <= 399;
    } finally {
      clearTimeout(handle);
    }
  } catch {
    return false;
  }
}

function selectWorkspace(
  workspaces: ProjectWorkspaceEntry[],
  workspaceRootAbs: string,
): ProjectWorkspaceEntry | null {
  for (const workspace of workspaces) {
    if (workspace.projectRoot === workspaceRootAbs) return workspace;
  }
  return null;
}

async function runRequiredHealthChecks(workspace: ProjectWorkspaceEntry): Promise<{
  ok: true;
  checks: string[];
} | {
  ok: false;
  checks: string[];
  failures: string[];
  nextAction: string;
  requiredUserAction: string[];
}> {
  const retryMaxRaw = workspace.defaults?.retryMax;
  const retryMax =
    typeof retryMaxRaw === "number" && Number.isFinite(retryMaxRaw) && retryMaxRaw > 0
      ? Math.floor(retryMaxRaw)
      : 1;
  const timeoutDefaultRaw = workspace.defaults?.requestTimeoutMs;
  const timeoutDefaultMs =
    typeof timeoutDefaultRaw === "number" && Number.isFinite(timeoutDefaultRaw) && timeoutDefaultRaw > 0
      ? Math.floor(timeoutDefaultRaw)
      : 3000;
  const systems = workspace.externalSystems ?? [];
  const failures: string[] = [];
  const checks: string[] = [];
  for (const system of systems) {
    for (const check of system.healthChecks ?? []) {
      const required = check.required === true;
      if (!required) continue;
      const timeoutMs = typeof check.timeoutMs === "number" ? check.timeoutMs : timeoutDefaultMs;
      let ok = false;
      for (let attempt = 1; attempt <= retryMax; attempt += 1) {
        if (check.type === "tcp") {
          ok = await tcpCheck(check.target, timeoutMs);
        } else {
          ok = await httpCheck(
            check.url,
            check.method ?? "GET",
            timeoutMs,
            check.expect?.status,
          );
        }
        if (ok) break;
      }
      checks.push(`${system.name}:${check.id}=${ok ? "ready" : "unreachable"}`);
      if (!ok) failures.push(`${system.name}:${check.id}`);
    }
  }
  if (failures.length > 0) {
    return {
      checks,
      failures,
      nextAction: `Ensure services are running or update .env/runtime config for: ${failures.join(", ")}.`,
      ok: false,
      requiredUserAction: [`External health checks failed: ${failures.join(", ")}`],
    };
  }
  return { ok: true, checks };
}

async function defaultRuntimeStarter(args: {
  runtimeContext: ProjectRuntimeContext;
  workspaceRootAbs: string;
}): Promise<RuntimeStartResult> {
  const { runtimeContext, workspaceRootAbs } = args;
  if (runtimeContext.mode !== "docker") {
    return {
      attempted: false,
      success: false,
      detail: `Runtime mode '${runtimeContext.mode}' does not have auto-start command wiring in v1.`,
    };
  }
  if (!runtimeContext.composeFile) {
    return {
      attempted: true,
      success: false,
      detail: "Docker runtime context requires composeFile for auto-start.",
    };
  }
  const composeFileAbs = path.isAbsolute(runtimeContext.composeFile)
    ? runtimeContext.composeFile
    : path.resolve(workspaceRootAbs, runtimeContext.composeFile);
  const command = "docker";
  const cmdArgs = ["compose", "-f", composeFileAbs, "up", "-d"];
  const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
    const child = spawn(command, cmdArgs, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("close", (code) => resolve({ code: typeof code === "number" ? code : 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err.message ?? err) }));
  });
  if (result.code === 0) {
    return { attempted: true, success: true, detail: `Started via docker compose: ${composeFileAbs}` };
  }
  return {
    attempted: true,
    success: false,
    detail: `docker compose start failed (${composeFileAbs}): ${result.stderr.trim()}`,
  };
}

function selectRuntimeContext(args: {
  runtimeContexts: ProjectRuntimeContext[];
  requestedName?: string;
}): { selected?: ProjectRuntimeContext; reasonCode?: ProjectContextBlockedReason; nextAction?: string; requiredUserAction?: string[] } {
  const { runtimeContexts, requestedName } = args;
  if (runtimeContexts.length === 0) return {};
  if (requestedName) {
    const match = runtimeContexts.find((entry) => entry.name === requestedName);
    if (!match) {
      return {
        reasonCode: "runtime_context_unknown",
        nextAction: `Choose an existing runtime context instead of '${requestedName}'.`,
        requiredUserAction: [`Unknown runtime context '${requestedName}'.`],
      };
    }
    return { selected: match };
  }
  const terminal = runtimeContexts.find((entry) => entry.mode === "terminal");
  const selected = terminal ?? runtimeContexts[0];
  if (!selected) return {};
  return { selected };
}

export async function resolveProjectContextForRegression(
  args: ResolveProjectContextArgs,
): Promise<ProjectContextResolutionResult> {
  let parsed;
  try {
    parsed = await readProjectArtifact(args.projectsFileAbs);
  } catch {
    return {
      status: "blocked",
      reasonCode: "project_artifact_missing",
      requiredUserAction: [`Create project artifact at ${args.projectsFileAbs}.`],
    };
  }
  if (!parsed.ok) {
    return {
      status: "blocked",
      reasonCode: parsed.reasonCode,
      requiredUserAction: parsed.errors,
    };
  }
  const workspace = selectWorkspace(parsed.artifact.workspaces, args.workspaceRootAbs);
  if (!workspace) {
    return {
      status: "blocked",
      reasonCode: "workspace_root_invalid",
      checks: [],
      nextAction: `Add workspace projectRoot '${args.workspaceRootAbs}' to projects.json.`,
      requiredUserAction: [`Add workspace projectRoot '${args.workspaceRootAbs}' to projects.json.`],
    };
  }

  const runtimeContexts = workspace.runtimeContexts ?? [];
  let selectedRuntimeContextName: string | undefined;
  let selectedRuntimeContext: ProjectRuntimeContext | undefined;
  if (runtimeContexts.length > 0) {
    const runtimeSelection = selectRuntimeContext({
      runtimeContexts,
      ...(args.runtimeContextName ? { requestedName: args.runtimeContextName } : {}),
    });
    if (runtimeSelection.reasonCode) {
      const blocked: ProjectContextResolutionResult = {
        status: "blocked",
        reasonCode: runtimeSelection.reasonCode,
        checks: [],
        requiredUserAction: runtimeSelection.requiredUserAction ?? ["Unknown runtime context."],
      };
      if (runtimeSelection.nextAction) blocked.nextAction = runtimeSelection.nextAction;
      return {
        ...blocked,
      };
    }
    selectedRuntimeContext = runtimeSelection.selected;
    selectedRuntimeContextName = runtimeSelection.selected?.name;
  }

  const env = args.env ?? process.env;
  const contextPatch: Record<string, unknown> = {};
  const bearerKey = workspace.auth?.bearerTokenEnv;
  if (bearerKey) {
    const bearer = env[bearerKey];
    if (!bearer || bearer.trim().length === 0) {
      return {
        status: "blocked",
        reasonCode: "env_key_missing",
        missing: [bearerKey],
        checks: [],
        nextAction: `Set ${bearerKey} in .env or environment and retry.`,
        requiredUserAction: [`Set env key '${bearerKey}' before running regression.`],
      };
    }
    contextPatch["auth.bearer"] = bearer;
  }

  if (selectedRuntimeContext) {
    contextPatch["runtime.context.name"] = selectedRuntimeContext.name;
    contextPatch["runtime.context.mode"] = selectedRuntimeContext.mode;
    const autoStart =
      typeof selectedRuntimeContext.autoStart === "boolean"
        ? selectedRuntimeContext.autoStart
        : true;
    const autoStopOnFinish =
      typeof selectedRuntimeContext.autoStopOnFinish === "boolean"
        ? selectedRuntimeContext.autoStopOnFinish
        : true;
    contextPatch["runtime.autoStart"] = autoStart;
    contextPatch["runtime.autoStopOnFinish"] = autoStopOnFinish;
  }

  if (args.healthChecksEnabled !== false) {
    let health = await runRequiredHealthChecks(workspace);
    let autoStartDetail: string | undefined;
    let autoStartAttempted = false;
    let autoStarted = false;
    const autoStartEnabled =
      selectedRuntimeContext ? (typeof selectedRuntimeContext.autoStart === "boolean" ? selectedRuntimeContext.autoStart : true) : false;
    if (!health.ok && selectedRuntimeContext && autoStartEnabled) {
      const starter = args.runtimeStarter ?? defaultRuntimeStarter;
      const startResult = await starter({
        runtimeContext: selectedRuntimeContext,
        workspaceRootAbs: workspace.projectRoot,
      });
      autoStartAttempted = startResult.attempted;
      autoStarted = startResult.success;
      autoStartDetail = startResult.detail;
      health = await runRequiredHealthChecks(workspace);
    }
    if (!health.ok) {
      const checks = [...health.checks];
      if (autoStartAttempted) {
        checks.push(`runtime:auto_start=${autoStarted ? "ok" : "failed"}`);
      }
      if (autoStartDetail) {
        checks.push(`runtime:auto_start_detail=${autoStartDetail}`);
      }
      return {
        status: "blocked",
        reasonCode: "external_healthcheck_failed",
        checks,
        nextAction: health.nextAction,
        requiredUserAction: health.requiredUserAction,
      };
    }
    if (autoStartAttempted) {
      contextPatch["runtime.autoStartAttempted"] = true;
      contextPatch["runtime.autoStarted"] = autoStarted;
      if (autoStartDetail) contextPatch["runtime.autoStartDetail"] = autoStartDetail;
    }
  }

  return {
    status: "ok",
    contextPatch,
    ...(selectedRuntimeContextName ? { runtimeContextName: selectedRuntimeContextName } : {}),
  };
}
