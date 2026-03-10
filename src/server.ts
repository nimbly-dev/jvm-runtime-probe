#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnvAndArgs } from "./config/server-config";
import { CONFIG_DEFAULTS } from "./config/defaults";
import { registerProjectContextValidateTool } from "./tools/core/project_context_validate/handler";
import { registerProbeCheckTool } from "./tools/core/probe_check/handler";
import { registerTargetInferTool } from "./tools/core/target_infer/handler";
import { registerRecipeCreateTool } from "./tools/core/recipe_generate/handler";
import { registerProbeTools } from "./tools/core/probe/handler";

async function main() {
  const cfg = loadConfigFromEnvAndArgs(process.argv);
  const probeStatusPath = cfg.probeStatusPath;
  const probeResetPath = cfg.probeResetPath;
  const probeActuatePath = CONFIG_DEFAULTS.PROBE_ACTUATE_PATH;
  const probeCapturePath = cfg.probeCapturePath;

  const server = new McpServer({
    name: "mcp-jvm-debugger",
    version: "0.1.0",
  });

  // Register at least one resource so Codex doesn't spam resources/list with "method not found".
  server.registerResource(
    "status",
    "mcp-jvm-debugger://status",
    { mimeType: "application/json", description: "Server status and defaults" },
    async () => {
      const payload = {
        ok: true,
        name: "mcp-jvm-debugger",
        version: "0.1.0",
        workspaceRoot: cfg.workspaceRootAbs,
        workspaceRootSource: cfg.workspaceRootSource,
        probe: {
          baseUrl: cfg.probeBaseUrl,
          statusPath: probeStatusPath,
          resetPath: probeResetPath,
          actuatePath: probeActuatePath,
          capturePath: probeCapturePath,
          waitMaxRetriesDefault: cfg.probeWaitMaxRetries,
          waitUnreachableRetryEnabled: cfg.probeWaitUnreachableRetryEnabled,
          waitUnreachableMaxRetries: cfg.probeWaitUnreachableMaxRetries,
        },
        recipe: {
          hasCustomTemplate: false,
        },
        auth: {
          credentialDiscovery: "disabled",
        },
        time: new Date().toISOString(),
      };
      return {
        contents: [
          {
            uri: "mcp-jvm-debugger://status",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "debug_check",
    {
      description: "Sanity check: confirms the MCP server is reachable.",
      inputSchema: {},
    },
    async () => {
      const structuredContent = {
        ok: true,
        serverTime: new Date().toISOString(),
        version: "0.1.0",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    },
  );

  registerProjectContextValidateTool(server);
  registerProbeCheckTool(server, {
    probeBaseUrl: cfg.probeBaseUrl,
    probeStatusPath,
    probeResetPath,
  });
  registerTargetInferTool(server, {
    config: cfg,
  });
  registerRecipeCreateTool(server, {
    probeBaseUrl: cfg.probeBaseUrl,
    probeStatusPath,
  });
  registerProbeTools(server, {
    probeBaseUrl: cfg.probeBaseUrl,
    probeStatusPath,
    probeResetPath,
    probeActuatePath,
    probeCapturePath,
    probeWaitMaxRetries: cfg.probeWaitMaxRetries,
    probeWaitUnreachableRetryEnabled: cfg.probeWaitUnreachableRetryEnabled,
    probeWaitUnreachableMaxRetries: cfg.probeWaitUnreachableMaxRetries,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-jvm-debugger 0.1.0 running (stdio). workspaceRoot=${cfg.workspaceRootAbs} probeBaseUrl=${cfg.probeBaseUrl}`,
  );
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
