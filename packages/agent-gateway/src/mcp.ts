import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentGateway } from "./gateway.js";

export async function runMcpGateway(): Promise<void> {
  const gateway = new AgentGateway();
  const server = new Server(
    { name: "relay-browser-agent-gateway", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: gateway.listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await gateway.execute(
        request.params.name,
        (request.params.arguments || {}) as Record<string, any>
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result && typeof result === "object" ? result : { result },
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  process.once("SIGINT", () => gateway.disconnect());
  process.once("SIGTERM", () => gateway.disconnect());
  await server.connect(transport);
}
