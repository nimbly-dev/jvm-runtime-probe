import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  RegressionRunArtifactsWriteResult,
  WriteRegressionRunArtifactsInput,
} from "@tools-regression-execution-plan-spec/models/regression_run_artifact.model";

export type {
  RegressionPlanReference,
  RegressionRunArtifactsWriteResult,
  RegressionRunExecutionResult,
  RegressionRunStatus,
  WriteRegressionRunArtifactsInput,
} from "@tools-regression-execution-plan-spec/models/regression_run_artifact.model";

const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_\d{2}$/;
const SECRET_KEY_PATTERN = /(?:token|secret|password|authorization|api[-_]?key|bearer)/i;
const SECRET_VALUE_PATTERN =
  /(?:\bbearer\s+[a-z0-9\-._~+/]+=*|\bghp_[a-z0-9]+|\bsk-[a-z0-9]{12,}|\bapi[_-]?key\b|\bpassword\b)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeByKey(
  value: unknown,
  explicitSecretPaths: Set<string>,
  parentPath: string | null = null,
): unknown {
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeByKey(item, explicitSecretPaths, parentPath));
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    const isExplicitSecret = explicitSecretPaths.has(key) || explicitSecretPaths.has(currentPath);
    const isPatternSecret = SECRET_KEY_PATTERN.test(key);
    if (isExplicitSecret || isPatternSecret) {
      continue;
    }
    output[key] = sanitizeByKey(child, explicitSecretPaths, currentPath);
  }
  return output;
}

function normalizeDiscoveryEvidence(discovery: unknown): unknown {
  if (!isRecord(discovery)) return undefined;
  const attempted = discovery.attempted === true;
  const status = discovery.status === "blocked" ? "blocked" : "resolved";
  const reasonCode = typeof discovery.reasonCode === "string" ? discovery.reasonCode : "ok";
  const rawOutcomes = Array.isArray(discovery.outcomes) ? discovery.outcomes : [];

  const outcomes = rawOutcomes
    .filter((entry) => isRecord(entry))
    .map((entry) => {
      const output: Record<string, unknown> = {
        key: String(entry.key ?? ""),
        source: entry.source === "runtime_context" ? "runtime_context" : "datasource",
        outcome: String(entry.outcome ?? "blocked_runtime_error"),
        reasonCode: String(entry.reasonCode ?? "discovery_adapter_failure"),
      };
      if (typeof entry.candidateCount === "number") output.candidateCount = entry.candidateCount;
      if (typeof entry.sourceRef === "string") output.sourceRef = entry.sourceRef;
      return output;
    })
    .sort((a, b) => {
      const lhs = `${String(a.key)}:${String(a.source)}`;
      const rhs = `${String(b.key)}:${String(b.source)}`;
      return lhs.localeCompare(rhs);
    });

  return {
    attempted,
    status,
    reasonCode,
    outcomes,
  };
}

function normalizeEvidencePayload(evidence: Record<string, unknown>): Record<string, unknown> {
  if (!("discovery" in evidence)) return evidence;
  const normalized = { ...evidence };
  const discovery = normalizeDiscoveryEvidence(evidence.discovery);
  if (typeof discovery === "undefined") {
    delete normalized.discovery;
  } else {
    normalized.discovery = discovery;
  }
  return normalized;
}

async function writeJsonFile(filePathAbs: string, payload: Record<string, unknown>): Promise<void> {
  await fs.writeFile(filePathAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function buildRunArtifactDirAbs(workspaceRootAbs: string, runId: string): string {
  if (!workspaceRootAbs || workspaceRootAbs.trim() === "") {
    throw new Error("workspace_root_missing");
  }
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("run_id_invalid");
  }
  return path.join(workspaceRootAbs, ".mcpjvm", "runs", runId);
}

export async function writeRegressionRunArtifacts(
  args: WriteRegressionRunArtifactsInput,
): Promise<RegressionRunArtifactsWriteResult> {
  const runDirAbs = buildRunArtifactDirAbs(args.workspaceRootAbs, args.runId);
  await fs.mkdir(runDirAbs, { recursive: true });

  const explicitSecretPaths = new Set(args.secretContextKeys ?? []);
  const now = args.now ?? new Date();

  const contextResolvedPathAbs = path.join(runDirAbs, "context.resolved.json");
  const executionResultPathAbs = path.join(runDirAbs, "execution.result.json");
  const evidencePathAbs = path.join(runDirAbs, "evidence.json");

  const contextResolvedPayload = sanitizeByKey(
    {
      resolvedAt: now.toISOString(),
      ...(args.planRef ? { planRef: args.planRef } : {}),
      ...args.resolvedContext,
    },
    explicitSecretPaths,
  ) as Record<string, unknown>;

  const executionResultPayload = sanitizeByKey(
    {
      ...args.executionResult,
      ...(args.planRef ? { planRef: args.planRef } : {}),
      runId: args.runId,
    },
    explicitSecretPaths,
  ) as Record<string, unknown>;

  const evidencePayload = sanitizeByKey(
    {
      ...normalizeEvidencePayload(args.evidence),
      ...(args.planRef ? { planRef: args.planRef } : {}),
      runId: args.runId,
    },
    explicitSecretPaths,
  ) as Record<string, unknown>;

  await writeJsonFile(contextResolvedPathAbs, contextResolvedPayload);
  await writeJsonFile(executionResultPathAbs, executionResultPayload);
  await writeJsonFile(evidencePathAbs, evidencePayload);

  return {
    runDirAbs,
    contextResolvedPathAbs,
    executionResultPathAbs,
    evidencePathAbs,
  };
}

