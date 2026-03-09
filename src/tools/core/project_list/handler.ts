import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECT_LIST_TOOL } from "./contract";
import { listProjectsDomain, type ProjectListDomainDeps } from "./domain";

export type ProjectListHandlerDeps = ProjectListDomainDeps;

export function registerProjectListTool(server: McpServer, deps: ProjectListHandlerDeps): void {
  server.registerTool(
    PROJECT_LIST_TOOL.name,
    {
      description: PROJECT_LIST_TOOL.description,
      inputSchema: PROJECT_LIST_TOOL.inputSchema,
    },
    async (input) => listProjectsDomain(input, deps),
  );
}
