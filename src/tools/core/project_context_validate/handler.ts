import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECT_CONTEXT_VALIDATE_TOOL } from "@/tools/core/project_context_validate/contract";
import { projectContextValidateDomain } from "@/tools/core/project_context_validate/domain";

export function registerProjectContextValidateTool(server: McpServer): void {
  server.registerTool(
    PROJECT_CONTEXT_VALIDATE_TOOL.name,
    {
      description: PROJECT_CONTEXT_VALIDATE_TOOL.description,
      inputSchema: PROJECT_CONTEXT_VALIDATE_TOOL.inputSchema,
    },
    async ({ projectRootAbs }) => projectContextValidateDomain({ projectRootAbs }),
  );
}
