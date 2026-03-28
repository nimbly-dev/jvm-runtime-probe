import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function resolveRepoRoot(startDirAbs: string): string {
  let currentDirAbs = path.resolve(startDirAbs);

  while (true) {
    const packageJsonAbs = path.join(currentDirAbs, "package.json");
    if (fsSync.existsSync(packageJsonAbs)) {
      try {
        const packageJson = JSON.parse(fsSync.readFileSync(packageJsonAbs, "utf8")) as {
          name?: string;
        };
        if (packageJson.name === "mcp-java-dev-tools") {
          return currentDirAbs;
        }
      } catch {
        // Ignore invalid JSON and continue walking upward.
      }
    }

    const parentDirAbs = path.dirname(currentDirAbs);
    if (parentDirAbs === currentDirAbs) {
      break;
    }
    currentDirAbs = parentDirAbs;
  }

  throw new Error(`Unable to resolve repository root from ${startDirAbs}`);
}

export const repoRootAbs = resolveRepoRoot(__dirname);
export const socialPlatformRootAbs = path.join(
  repoRootAbs,
  "test",
  "fixtures",
  "spring-apps",
  "social-platform",
);
export const postAppProjectRootAbs = path.join(
  socialPlatformRootAbs,
  "post-service",
  "post-app",
);
export const postAppTargetDirAbs = path.join(postAppProjectRootAbs, "target");
export const agentTargetDirAbs = path.join(
  repoRootAbs,
  "java-agent",
  "core",
  "core-probe",
  "target",
);
export const mcpServerEntryAbs = path.join(repoRootAbs, "dist", "server.js");
export const postControllerFqcn = "com.example.social.post.app.controller.PostController";
export const postControllerSourceFileAbs = path.join(
  postAppProjectRootAbs,
  "src",
  "main",
  "java",
  "com",
  "example",
  "social",
  "post",
  "app",
  "controller",
  "PostController.java",
);

const LOG_TAIL_LIMIT = 200;

type RunningApp = {
  apiBaseUrl: string;
  probeBaseUrl: string;
  stop: () => Promise<void>;
  logs: () => string;
};

type RunningMcpClient = {
  client: InstanceType<typeof Client>;
  close: () => Promise<void>;
  logs: () => string;
};

function appendLog(buffer: string[], chunk: string | Buffer) {
  const text = String(chunk);
  if (text.length === 0) return;
  buffer.push(text);
  if (buffer.length > LOG_TAIL_LIMIT) {
    buffer.splice(0, buffer.length - LOG_TAIL_LIMIT);
  }
}

async function assertFileExists(fileAbs: string, label: string): Promise<void> {
  try {
    await fs.access(fileAbs);
  } catch {
    throw new Error(`${label} not found: ${fileAbs}`);
  }
}

async function resolveJarByPattern(args: {
  dirAbs: string;
  include: RegExp;
  exclude?: RegExp;
  label: string;
}): Promise<string> {
  let entries: string[];
  try {
    entries = await fs.readdir(args.dirAbs);
  } catch {
    throw new Error(`${args.label} directory not found: ${args.dirAbs}`);
  }

  const matches = entries
    .filter((entry) => args.include.test(entry))
    .filter((entry) => !(args.exclude?.test(entry) ?? false))
    .sort();

  if (matches.length === 0) {
    throw new Error(`${args.label} not found in ${args.dirAbs}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${args.label} is ambiguous in ${args.dirAbs}: ${matches.join(", ")}`,
    );
  }

  return path.join(args.dirAbs, matches[0]!);
}

async function waitFor(
  check: () => Promise<boolean>,
  args: { timeoutMs: number; intervalMs?: number; failureMessage: string },
): Promise<void> {
  const timeoutAt = Date.now() + args.timeoutMs;
  const intervalMs = args.intervalMs ?? 500;
  while (Date.now() < timeoutAt) {
    if (await check()) return;
    await delay(intervalMs);
  }
  throw new Error(args.failureMessage);
}

async function isHttpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function allocateFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate an ephemeral port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function forceStop(child: import("node:child_process").ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await delay(1_000);
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Ignore forced kill errors during cleanup.
    }
  }
}

export async function findLineNumberBySnippet(
  fileAbs: string,
  snippet: string,
): Promise<number> {
  const source = await fs.readFile(fileAbs, "utf8");
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(snippet));
  if (index < 0) {
    throw new Error(`Snippet not found in ${fileAbs}: ${snippet}`);
  }
  return index + 1;
}

export function buildLineKey(args: { fqcn: string; methodName: string; line: number }): string {
  return `${args.fqcn}#${args.methodName}:${args.line}`;
}

export async function startPostAppWithAgent(args?: {
  appPort?: number;
  probePort?: number;
  actuateAuthToken?: string;
  agentInclude?: string;
  agentExclude?: string;
}): Promise<RunningApp> {
  const agentJarAbs = await resolveJarByPattern({
    dirAbs: agentTargetDirAbs,
    include: /^mcp-java-dev-tools-agent-.*-all\.jar$/,
    label: "java agent jar",
  });
  const postAppJarAbs = await resolveJarByPattern({
    dirAbs: postAppTargetDirAbs,
    include: /^post-app-.*\.jar$/,
    exclude: /\.jar\.original$/,
    label: "post-app jar",
  });
  await assertFileExists(agentJarAbs, "java agent jar");
  await assertFileExists(postAppJarAbs, "post-app jar");

  const appPort = args?.appPort ?? (await allocateFreePort());
  const probePort = args?.probePort ?? (await allocateFreePort());
  const apiBaseUrl = `http://127.0.0.1:${appPort}`;
  const probeBaseUrl = `http://127.0.0.1:${probePort}`;
  const logBuffer: string[] = [];

  const agentInclude = args?.agentInclude?.trim() ?? "com.example.social.**";
  const agentExclude = args?.agentExclude?.trim() ?? "**.config.**";
  const agentOptions = [`host=127.0.0.1`, `port=${probePort}`];
  if (agentInclude.length > 0) agentOptions.push(`include=${agentInclude}`);
  if (agentExclude.length > 0) agentOptions.push(`exclude=${agentExclude}`);
  agentOptions.push("allowJava21=true");
  const javaAgentArg = `-javaagent:${agentJarAbs}=` + agentOptions.join(";");

  const javaArgs = [javaAgentArg];
  if (typeof args?.actuateAuthToken === "string" && args.actuateAuthToken.trim().length > 0) {
    javaArgs.push(`-Dmcp.probe.auth.actuate.token=${args.actuateAuthToken.trim()}`);
  }
  javaArgs.push("-jar", postAppJarAbs, `--server.port=${appPort}`);

  const child = spawn("java", javaArgs, {
      cwd: postAppProjectRootAbs,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

  child.stdout?.on("data", (chunk) => appendLog(logBuffer, chunk));
  child.stderr?.on("data", (chunk) => appendLog(logBuffer, chunk));

  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null) return false;
        const appReady = await isHttpOk(`${apiBaseUrl}/actuator/health`);
        if (!appReady) return false;
        return await isHttpOk(`${probeBaseUrl}/__probe/status?key=fixture.health.Check#noop:1`);
      },
      {
        timeoutMs: 60_000,
        intervalMs: 750,
        failureMessage:
          `post-app failed to become ready. apiBaseUrl=${apiBaseUrl} probeBaseUrl=${probeBaseUrl}\n` +
          logBuffer.join(""),
      },
    );
  } catch (error) {
    await forceStop(child);
    throw error;
  }

  return {
    apiBaseUrl,
    probeBaseUrl,
    stop: async () => {
      await forceStop(child);
    },
    logs: () => logBuffer.join(""),
  };
}

export async function startMcpClient(args: {
  workspaceRootAbs: string;
  probeBaseUrl: string;
}): Promise<RunningMcpClient> {
  await assertFileExists(mcpServerEntryAbs, "mcp server dist entry");

  const logBuffer: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpServerEntryAbs],
    cwd: repoRootAbs,
    env: {
      MCP_WORKSPACE_ROOT: args.workspaceRootAbs,
      MCP_PROBE_BASE_URL: args.probeBaseUrl,
    },
    stderr: "pipe",
  });

  transport.stderr?.on("data", (chunk) => appendLog(logBuffer, chunk));

  const client = new Client({
    name: "mcp-java-dev-tools-it",
    version: "it",
  });

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw new Error(`Failed to start MCP client.\n${logBuffer.join("\n")}\n${String(error)}`);
  }

  return {
    client,
    close: async () => {
      await transport.close();
    },
    logs: () => logBuffer.join(""),
  };
}
