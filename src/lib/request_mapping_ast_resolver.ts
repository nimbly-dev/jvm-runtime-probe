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
const AST_RESOLVER_CLASSPATH_ENV = "MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH";
const JAVA_BIN_ENV = "MCP_JAVA_BIN";
const CORE_REQUEST_MAPPER_MAIN_CLASS =
  "com.nimbly.mcpjvmdebugger.requestmapping.RequestMappingResolverMain";

type ResolverLaunch = {
  args: string[];
  evidence: string[];
};

async function fileExists(fileAbs: string): Promise<boolean> {
  try {
    await fs.access(fileAbs);
    return true;
  } catch {
    return false;
  }
}

async function resolveLaunch(): Promise<ResolverLaunch | undefined> {
  const configuredClasspath = process.env[AST_RESOLVER_CLASSPATH_ENV]?.trim();
  if (configuredClasspath) {
    return {
      args: ["-cp", configuredClasspath, CORE_REQUEST_MAPPER_MAIN_CLASS],
      evidence: [`envClasspath=${configuredClasspath}`],
    };
  }

  const configured = process.env[AST_RESOLVER_JAR_ENV]?.trim();
  if (configured) {
    return {
      args: ["-jar", configured],
      evidence: [`envJarPath=${configured}`],
    };
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const versionCandidates = Array.from(
    new Set([getContractVersion(), "0.1.0"].filter((v) => v && v !== "unknown")),
  );
  const mapperCoreCandidates: string[] = [];
  const springPluginCandidates: string[] = [];
  const legacyCandidates: string[] = [];

  for (const version of versionCandidates) {
    mapperCoreCandidates.push(
      path.join(
        repoRoot,
        "java-agent",
        "core-request-mapper",
        "target",
        `mcp-jvm-core-request-mapper-${version}-all.jar`,
      ),
      path.join(
        repoRoot,
        "java-agent",
        "core-request-mapper",
        "target",
        `mcp-jvm-core-request-mapper-${version}.jar`,
      ),
    );
    springPluginCandidates.push(
      path.join(
        repoRoot,
        "java-agent",
        "request-mapper-spring",
        "target",
        `mcp-jvm-request-mapper-spring-${version}.jar`,
      ),
    );
    legacyCandidates.push(
      path.join(
        repoRoot,
        "java-agent",
        "request-mapping-resolver",
        "target",
        `mcp-jvm-request-mapping-resolver-${version}-all.jar`,
      ),
      path.join(
        repoRoot,
        "java-agent",
        "request-mapping-resolver",
        "target",
        `mcp-jvm-request-mapping-resolver-${version}.jar`,
      ),
    );
  }

  let selectedCoreMapperJar: string | undefined;
  for (const candidate of mapperCoreCandidates) {
    if (await fileExists(candidate)) {
      selectedCoreMapperJar = candidate;
      break;
    }
  }
  if (selectedCoreMapperJar) {
    const classpathEntries = [selectedCoreMapperJar];
    let springPluginJar: string | undefined;
    for (const pluginCandidate of springPluginCandidates) {
      if (await fileExists(pluginCandidate)) {
        springPluginJar = pluginCandidate;
        classpathEntries.push(pluginCandidate);
        break;
      }
    }
    return {
      args: ["-cp", classpathEntries.join(path.delimiter), CORE_REQUEST_MAPPER_MAIN_CLASS],
      evidence: [
        `coreMapperJar=${selectedCoreMapperJar}`,
        `springPluginJar=${springPluginJar ?? "(missing)"}`,
      ],
    };
  }

  for (const candidate of legacyCandidates) {
    if (await fileExists(candidate)) {
      return {
        args: ["-jar", candidate],
        evidence: [`legacyJarPath=${candidate}`],
      };
    }
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
      "Build the JVM request-mapping resolver artifacts or set MCP_JAVA_REQUEST_MAPPING_RESOLVER_CLASSPATH / MCP_JAVA_REQUEST_MAPPING_RESOLVER_JAR, then rerun probe_recipe_create.",
    evidence: [reason, ...evidence],
    attemptedStrategies: ["java_ast_resolver_bootstrap"],
  };
}

export async function resolveRequestMappingAst(
  input: JvmAstRequestMappingInput,
): Promise<JvmAstRequestMappingResult> {
  const launch = await resolveLaunch();
  if (!launch) {
    return buildUnavailableFailure("resolver_jar_missing=true", [
      `envJarPath=${process.env[AST_RESOLVER_JAR_ENV] ?? "(unset)"}`,
      `envClasspath=${process.env[AST_RESOLVER_CLASSPATH_ENV] ?? "(unset)"}`,
    ]);
  }

  const javaBin = process.env[JAVA_BIN_ENV]?.trim() || "java";

  return await new Promise<JvmAstRequestMappingResult>((resolve) => {
    const child = spawn(javaBin, launch.args, {
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
          `launchArgs=${launch.args.join(" ")}`,
          `timeoutMs=${DEFAULT_TIMEOUT_MS}`,
          ...launch.evidence,
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
          `launchArgs=${launch.args.join(" ")}`,
          `error=${err.message}`,
          ...launch.evidence,
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
            `launchArgs=${launch.args.join(" ")}`,
            `stderr=${stderr.trim() || "(empty)"}`,
            ...launch.evidence,
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
            `launchArgs=${launch.args.join(" ")}`,
            `stdout=${stdout.trim() || "(empty)"}`,
            `stderr=${stderr.trim() || "(empty)"}`,
            `error=${err instanceof Error ? err.message : String(err)}`,
            ...launch.evidence,
          ]),
        );
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}
