import { createInterface } from "node:readline";
import { AgentGateway } from "./gateway.js";

interface JsonlRequest {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
}

export async function runJsonlGateway(): Promise<void> {
  const gateway = new AgentGateway();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    if (!line.trim()) continue;
    let request: JsonlRequest;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
      continue;
    }

    try {
      const result = await dispatchJsonlRequest(gateway, request);
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    }
  }

  gateway.disconnect();
}

export async function dispatchJsonlRequest(
  gateway: AgentGateway,
  request: JsonlRequest
): Promise<any> {
  if (request.method === "tools/list") return { tools: gateway.listTools() };
  if (request.method === "tools/call") {
    const name = request.params?.name;
    if (typeof name !== "string") throw new Error("tools/call requires params.name");
    return gateway.execute(name, request.params?.arguments || {});
  }
  if (request.method === "status") return gateway.execute("relay_status");
  throw new Error(`Unsupported method: ${request.method || "missing"}`);
}
