import { createInterface } from "node:readline";
import { AgentGateway } from "./gateway.js";

interface JsonlRequest {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
}

export function resolveJsonlConcurrency(raw = process.env.RELAY_JSONL_CONCURRENCY): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
}

export async function runJsonlGateway(
  options: {
    gateway?: AgentGateway;
    input?: NodeJS.ReadableStream;
    write?: (line: string) => void;
    concurrency?: number;
  } = {}
): Promise<void> {
  const gateway = options.gateway ?? new AgentGateway();
  const write = options.write ?? ((line: string) => void process.stdout.write(line));
  const limit = options.concurrency ?? resolveJsonlConcurrency();
  const input = createInterface({ input: options.input ?? process.stdin, crlfDelay: Infinity });
  const inFlight = new Set<Promise<void>>();

  const handle = async (request: JsonlRequest) => {
    try {
      const result = await dispatchJsonlRequest(gateway, request);
      write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch (error) {
      write(
        `${JSON.stringify({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    }
  };

  for await (const line of input) {
    if (!line.trim()) continue;
    let request: JsonlRequest;
    try {
      request = JSON.parse(line);
    } catch {
      write(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
      continue;
    }

    while (inFlight.size >= limit) {
      await Promise.race(inFlight);
    }
    const task = handle(request).finally(() => inFlight.delete(task));
    inFlight.add(task);
  }

  await Promise.all(inFlight);
  await gateway.shutdown();
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
