import * as path from "node:path";

import { CliArgs } from "@/config/cli-args";
import { CONFIG_DEFAULTS } from "@/config/defaults";
import { MCP_ENV, type McpEnvVar } from "@/config/env-vars";

export type ServerConfig = {
  workspaceRootAbs: string;
  workspaceRootSource: "arg" | "env" | "session" | "cwd";
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
  probeCapturePath: string;
  probeLineSelectionMaxScanLines: number;
  probeWaitMaxRetries: number;
  probeWaitUnreachableRetryEnabled: boolean;
  probeWaitUnreachableMaxRetries: number;
};

export class ServerConfigLoader {
  private readonly args: CliArgs;

  constructor(argv: string[]) {
    this.args = new CliArgs(argv);
  }

  load(): ServerConfig {
    const argWorkspaceRoot = this.args.get("--workspace-root");
    const envWorkspaceRoot = this.env(MCP_ENV.WORKSPACE_ROOT);
    const sessionWorkspaceRoot = this.detectSessionWorkspaceRoot();
    const cwdWorkspaceRoot = process.cwd();

    const workspaceRoot =
      argWorkspaceRoot ?? envWorkspaceRoot ?? sessionWorkspaceRoot ?? cwdWorkspaceRoot;
    const workspaceRootSource: ServerConfig["workspaceRootSource"] = argWorkspaceRoot
      ? "arg"
      : envWorkspaceRoot
        ? "env"
        : sessionWorkspaceRoot
          ? "session"
          : "cwd";

    const probeBaseUrl = this.args.get("--probe-base-url") ?? this.env(MCP_ENV.PROBE_BASE_URL);

    const probeStatusPath = CONFIG_DEFAULTS.PROBE_STATUS_PATH;
    const probeResetPath = CONFIG_DEFAULTS.PROBE_RESET_PATH;
    const probeCapturePath = CONFIG_DEFAULTS.PROBE_CAPTURE_PATH;
    const probeLineSelectionMaxScanLines = this.parseIntFlag(
      this.env(MCP_ENV.PROBE_LINE_SELECTION_MAX_SCAN_LINES),
      CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES,
      CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES_MIN,
      CONFIG_DEFAULTS.PROBE_LINE_SELECTION_MAX_SCAN_LINES_MAX,
    );

    const probeWaitMaxRetries = this.parseIntFlag(
      this.args.get("--probe-wait-max-retries") ?? this.env(MCP_ENV.PROBE_WAIT_MAX_RETRIES),
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES,
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES_MIN,
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES_MAX,
    );
    const probeWaitUnreachableRetryEnabled = this.parseBooleanFlag(
      this.env(MCP_ENV.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED),
      CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_RETRY_ENABLED,
    );
    const probeWaitUnreachableMaxRetries = this.parseIntFlag(
      this.env(MCP_ENV.PROBE_WAIT_UNREACHABLE_MAX_RETRIES),
      CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES,
      CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES_MIN,
      CONFIG_DEFAULTS.PROBE_WAIT_UNREACHABLE_MAX_RETRIES_MAX,
    );

    const missing: string[] = [];
    if (!probeBaseUrl) missing.push(MCP_ENV.PROBE_BASE_URL);
    if (missing.length > 0) {
      throw new Error(
        `Missing required MCP config: ${missing.join(", ")}. ` +
          "Set required probe env vars when adding mcp-jvm-debugger.",
      );
    }

    const probeBaseUrlRequired = probeBaseUrl!;
    this.validateProbeBaseUrl(probeBaseUrlRequired);

    return {
      workspaceRootAbs: path.resolve(workspaceRoot),
      workspaceRootSource,
      probeBaseUrl: probeBaseUrlRequired,
      probeStatusPath,
      probeResetPath,
      probeCapturePath,
      probeLineSelectionMaxScanLines,
      probeWaitMaxRetries,
      probeWaitUnreachableRetryEnabled,
      probeWaitUnreachableMaxRetries,
    };
  }

  private env(name: McpEnvVar): string | undefined {
    return process.env[name];
  }

  private parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
    if (typeof raw !== "string") return defaultValue;
    const v = raw.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    return defaultValue;
  }

  private parseIntFlag(
    raw: string | undefined,
    defaultValue: number,
    min: number,
    max: number,
  ): number {
    if (typeof raw !== "string") return defaultValue;
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) return defaultValue;
    const n = Math.trunc(parsed);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  private detectSessionWorkspaceRoot(): string | undefined {
    const candidates = [
      process.env.CODEX_WORKSPACE_ROOT,
      process.env.CODEX_CWD,
      process.env.INIT_CWD,
      process.env.PWD,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length > 0) {
        return c.trim();
      }
    }
    return undefined;
  }

  private validateProbeBaseUrl(probeBaseUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(probeBaseUrl);
    } catch {
      throw new Error(
        `Invalid ${MCP_ENV.PROBE_BASE_URL}='${probeBaseUrl}'. ` +
          "Use full URL format like http://127.0.0.1:9193",
      );
    }
    if (!parsed.port) {
      throw new Error(
        `${MCP_ENV.PROBE_BASE_URL} must include an explicit probe port (example: http://127.0.0.1:9193). ` +
          "If unknown, ask the user which service probe port is currently mapped.",
      );
    }
  }
}

export function loadConfigFromEnvAndArgs(argv: string[]): ServerConfig {
  return new ServerConfigLoader(argv).load();
}
