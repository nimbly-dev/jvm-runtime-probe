import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { getContractVersion } from "@/config/contract-version";
import type {
  JvmAstRequestMappingInput,
  JvmAstRequestMappingResult,
} from "@/models/synthesis/request_mapping_ast.model";

const DEFAULT_TIMEOUT_MS = 15_000;
const AST_RESOLVER_JAR_ENV = "MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR";
const JAVA_BIN_ENV = "MCP_JAVA_BIN";

async function fileExists(fileAbs: string): Promise<boolean> {
  try {
    await fs.access(fileAbs);
    return true;
  } catch {
    return false;
  }
}

async function resolveJarPath(): Promise<string | undefined> {
  const configured = process.env[AST_RESOLVER_JAR_ENV]?.trim();
  if (configured) return configured;

  const repoRoot = path.resolve(__dirname, "..", "..");
  const candidates = [
    path.join(
      repoRoot,
      "java-agent",
      "request-mapping-resolver",
      "target",
      "mcp-jvm-request-mapping-resolver-0.1.0-all.jar",
    ),
    path.join(
      repoRoot,
      "java-agent",
      "request-mapping-resolver",
      "target",
      "mcp-jvm-request-mapping-resolver-0.1.0.jar",
    ),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

function buildUnavailableFailure(
  reason: string,
  evidence: string[],
): JvmAstRequestMappingResult {
  return {
    status: "report",
    contractVersion: getContractVersion(),
    reasonCode: "ast_resolver_unavailable",
    failedStep: "request_mapping_resolver_bootstrap",
    nextAction:
      "Build the JVM request-mapping resolver JAR or set MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR to its absolute path, then rerun probe_recipe_create.",
    evidence: [reason, ...evidence],
    attemptedStrategies: ["java_ast_resolver_bootstrap"],
  };
}

export async function resolveRequestMappingAst(
  input: JvmAstRequestMappingInput,
): Promise<JvmAstRequestMappingResult> {
  const jarPath = await resolveJarPath();
  if (!jarPath) {
    return buildUnavailableFailure("resolver_jar_missing=true", [
      `envJarPath=${process.env[AST_RESOLVER_JAR_ENV] ?? "(unset)"}`,
    ]);
  }

  const javaBin = process.env[JAVA_BIN_ENV]?.trim() || "java";

  return await new Promise<JvmAstRequestMappingResult>((resolve) => {
    const child = spawn(javaBin, ["-jar", jarPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(
        buildUnavailableFailure("resolver_process_timeout=true", [
          `jarPath=${jarPath}`,
          `timeoutMs=${DEFAULT_TIMEOUT_MS}`,
        ]),
      );
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(
        buildUnavailableFailure("resolver_process_spawn_failed=true", [
          `javaBin=${javaBin}`,
          `jarPath=${jarPath}`,
          `error=${err.message}`,
        ]),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(
          buildUnavailableFailure("resolver_process_nonzero_exit=true", [
            `exitCode=${String(code)}`,
            `jarPath=${jarPath}`,
            `stderr=${stderr.trim() || "(empty)"}`,
          ]),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as JvmAstRequestMappingResult;
        resolve(parsed);
      } catch (err) {
        resolve(
          buildUnavailableFailure("resolver_output_invalid_json=true", [
            `jarPath=${jarPath}`,
            `stdout=${stdout.trim() || "(empty)"}`,
            `stderr=${stderr.trim() || "(empty)"}`,
            `error=${err instanceof Error ? err.message : String(err)}`,
          ]),
        );
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}
