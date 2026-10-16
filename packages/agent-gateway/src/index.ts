#!/usr/bin/env node
import { getGatewayTools } from "./gateway.js";
import { runJsonlGateway } from "./jsonl.js";
import { runMcpGateway } from "./mcp.js";

export * from "./gateway.js";
export * from "./jsonl.js";

const args = new Set(process.argv.slice(2));

if (args.has("--manifest")) {
  process.stdout.write(`${JSON.stringify({ version: 1, tools: getGatewayTools() }, null, 2)}\n`);
} else if (args.has("--jsonl")) {
  await runJsonlGateway();
} else {
  await runMcpGateway();
}
