import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { probeDiagnose } from "@/tools/core/probe_check/domain";
import { PROBE_CHECK_TOOL } from "@/tools/core/probe_check/contract";

export type ProbeCheckHandlerDeps = {
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
};

export function registerProbeCheckTool(server: McpServer, deps: ProbeCheckHandlerDeps): void {
  server.registerTool(
    PROBE_CHECK_TOOL.name,
    {
      description: PROBE_CHECK_TOOL.description,
      inputSchema: PROBE_CHECK_TOOL.inputSchema,
    },
    async ({ baseUrl, timeoutMs }) => {
      const diagnoseArgs: Parameters<typeof probeDiagnose>[0] = {
        baseUrl: baseUrl ?? deps.probeBaseUrl,
        statusPath: deps.probeStatusPath,
        resetPath: deps.probeResetPath,
      };
      if (typeof timeoutMs === "number") diagnoseArgs.timeoutMs = timeoutMs;
      return await probeDiagnose(diagnoseArgs);
    },
  );
}
