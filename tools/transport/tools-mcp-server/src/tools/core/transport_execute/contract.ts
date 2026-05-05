import { TransportExecuteInputSchema } from "@/models/inputs";

export const TRANSPORT_EXECUTE_TOOL = {
  name: "transport_execute",
  description:
    "Execute transport request via MCP wrapper only. Fail-closed when wrapped execution policy is violated.",
  inputSchema: TransportExecuteInputSchema,
} as const;

