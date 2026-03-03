import * as path from "node:path";

import { CliArgs } from "./cli-args";
import { CONFIG_DEFAULTS } from "./defaults";
import { MCP_ENV, type McpEnvVar } from "./env-vars";

export type ServerConfig = {
  workspaceRootAbs: string;
  probeBaseUrl: string;
  probeWaitMaxRetries: number;
  recipeOutputTemplate?: string;
  authLoginDiscoveryEnabled: boolean;
};

export class ServerConfigLoader {
  private readonly args: CliArgs;

  constructor(argv: string[]) {
    this.args = new CliArgs(argv);
  }

  load(): ServerConfig {
    const workspaceRoot =
      this.args.get("--workspace-root") ??
      this.env(MCP_ENV.WORKSPACE_ROOT) ??
      process.cwd();

    const probeBaseUrl =
      this.args.get("--probe-base-url") ??
      this.env(MCP_ENV.PROBE_BASE_URL);

    const recipeOutputTemplate =
      this.args.get("--recipe-output-template") ??
      this.env(MCP_ENV.RECIPE_OUTPUT_TEMPLATE);

    const probeWaitMaxRetries = this.parseIntFlag(
      this.args.get("--probe-wait-max-retries") ??
        this.env(MCP_ENV.PROBE_WAIT_MAX_RETRIES),
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES,
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES_MIN,
      CONFIG_DEFAULTS.PROBE_WAIT_MAX_RETRIES_MAX,
    );

    const authLoginDiscoveryEnabled = this.parseBooleanFlag(
      this.args.get("--auth-login-discovery-enabled") ??
        this.env(MCP_ENV.AUTH_LOGIN_DISCOVERY_ENABLED),
      CONFIG_DEFAULTS.AUTH_LOGIN_DISCOVERY_ENABLED,
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
      probeBaseUrl: probeBaseUrlRequired,
      probeWaitMaxRetries,
      authLoginDiscoveryEnabled,
      ...(recipeOutputTemplate ? { recipeOutputTemplate } : {}),
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

  private parseIntFlag(raw: string | undefined, defaultValue: number, min: number, max: number): number {
    if (typeof raw !== "string") return defaultValue;
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) return defaultValue;
    const n = Math.trunc(parsed);
    if (n < min) return min;
    if (n > max) return max;
    return n;
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
