export const PROBE_REGISTRY_TOOLS = {
  list: {
    name: "probe_registry_list",
    description: "List active probe profile and registered probe endpoints.",
    inputSchema: {},
  },
  reload: {
    name: "probe_registry_reload",
    description: "Reload probe registry configuration from MCP_PROBE_CONFIG_FILE.",
    inputSchema: {},
  },
} as const;
