import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createProbeDomain } from "@/tools/core/probe/domain";
import { PROBE_TOOLS } from "@/tools/core/probe/contract";

export type ProbeHandlerConfig = {
  probeBaseUrl: string;
  probeStatusPath: string;
  probeResetPath: string;
  probeActuatePath: string;
  probeCapturePath: string;
  probeWaitMaxRetries: number;
  probeWaitUnreachableRetryEnabled: boolean;
  probeWaitUnreachableMaxRetries: number;
};

export function registerProbeTools(server: McpServer, cfg: ProbeHandlerConfig): void {
  const domain = createProbeDomain(cfg);
  server.registerTool(
    PROBE_TOOLS.enable.name,
    {
      description: PROBE_TOOLS.enable.description,
      inputSchema: PROBE_TOOLS.enable.inputSchema,
    },
    async (input) => domain.enable(input),
  );

  server.registerTool(
    PROBE_TOOLS.getCapture.name,
    {
      description: PROBE_TOOLS.getCapture.description,
      inputSchema: PROBE_TOOLS.getCapture.inputSchema,
    },
    async (input) => domain.getCapture(input),
  );

  server.registerTool(
    PROBE_TOOLS.getStatus.name,
    {
      description: PROBE_TOOLS.getStatus.description,
      inputSchema: PROBE_TOOLS.getStatus.inputSchema,
    },
    async (input) => domain.getStatus(input),
  );

  server.registerTool(
    PROBE_TOOLS.reset.name,
    {
      description: PROBE_TOOLS.reset.description,
      inputSchema: PROBE_TOOLS.reset.inputSchema,
    },
    async (input) => domain.reset(input),
  );

  server.registerTool(
    PROBE_TOOLS.waitForHit.name,
    {
      description: PROBE_TOOLS.waitForHit.description,
      inputSchema: PROBE_TOOLS.waitForHit.inputSchema,
    },
    async (input) => domain.waitForHit(input),
  );
}
