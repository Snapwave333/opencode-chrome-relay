import { RelayBrokerClient, RelayClientOptions } from "./client.js";
import { browserTools } from "./tools.js";
import { SessionContextManager, SessionBinding } from "./session.js";

export * from "./client.js";
export * from "./tools.js";
export * from "./session.js";
export * from "./vision.js";

export interface OpenCodePluginContext {
  client: RelayBrokerClient;
  sessionManager: SessionContextManager;
  tools: typeof browserTools;
}

export function createOpenCodeRelayPlugin(options: RelayClientOptions = {}): OpenCodePluginContext {
  const client = new RelayBrokerClient(options);
  const sessionManager = new SessionContextManager();

  return {
    client,
    sessionManager,
    tools: browserTools,
  };
}

// Default export for OpenCode plugin loader
export default function plugin() {
  return createOpenCodeRelayPlugin();
}
