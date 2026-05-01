import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ProbeRegistry } from "@/config/probe-registry";
import { probeDiagnose } from "@/tools/core/probe_check/domain";
import { PROBE_CHECK_TOOL } from "@/tools/core/probe_check/contract";
import { resolveProbeBaseUrl } from "@/utils/probe/probe_route_resolver.util";

export type ProbeCheckHandlerDeps = {
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
  getProbeRegistry?: () => ProbeRegistry | undefined;
};

export function registerProbeCheckTool(server: McpServer, deps: ProbeCheckHandlerDeps): void {
  server.registerTool(
    PROBE_CHECK_TOOL.name,
    {
      description: PROBE_CHECK_TOOL.description,
      inputSchema: PROBE_CHECK_TOOL.inputSchema,
    },
    async ({ baseUrl, probeId, http, timeoutMs }) => {
      const resolved = resolveProbeBaseUrl({
        toolName: "probe_check",
        defaultBaseUrl: deps.probeBaseUrl,
        ...(typeof probeId === "string" ? { probeId } : {}),
        ...(typeof baseUrl === "string" ? { baseUrl } : {}),
        ...(deps.getProbeRegistry?.() ? { probeRegistry: deps.getProbeRegistry?.() } : {}),
      });
      if (!resolved.ok) return resolved.response;
      const diagnoseArgs: Parameters<typeof probeDiagnose>[0] = {
        baseUrl: resolved.baseUrl,
        statusPath: deps.probeStatusPath,
        resetPath: deps.probeResetPath,
      };
      if (http && typeof http === "object" && http.headers && typeof http.headers === "object") {
        diagnoseArgs.http = { headers: http.headers };
      }
      if (typeof timeoutMs === "number") diagnoseArgs.timeoutMs = timeoutMs;
      return await probeDiagnose(diagnoseArgs);
    },
  );
}
