import { describe, expect, it } from "vitest";
import { AgentGateway, type RelayClientLike } from "../../packages/agent-gateway/src/gateway.js";
import { dispatchJsonlRequest } from "../../packages/agent-gateway/src/jsonl.js";

class FakeRelayClient implements RelayClientLike {
  public connected = false;
  public actions: any[] = [];
  public controls: string[] = [];

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public disconnect(): void {
    this.connected = false;
  }

  public async sendAction(action: any, tabId?: number): Promise<any> {
    this.actions.push({ action, tabId });
    return { executed: action.type, tab_id: tabId };
  }

  public async sendControl(command: any): Promise<any> {
    this.controls.push(command);
    return { command, state: "accepted" };
  }

  public getRunId(): string {
    return "run_test";
  }

  public getEpoch(): number {
    return 3;
  }
}

describe("AgentGateway", () => {
  it("exposes browser, control, status, and pipeline tools to every adapter", () => {
    const gateway = new AgentGateway({}, new FakeRelayClient());
    const names = gateway.listTools().map((tool) => tool.name);

    expect(names).toHaveLength(27);
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_screenshot");
    expect(names).toContain("relay_take_over");
    expect(names).toContain("browser_run_pipeline");
  });

  it("connects lazily and routes browser and control calls", async () => {
    const client = new FakeRelayClient();
    const gateway = new AgentGateway({}, client);

    await gateway.execute("browser_navigate", { url: "https://example.com" });
    await gateway.execute("relay_pause");

    expect(client.connected).toBe(true);
    expect(client.actions[0].action).toMatchObject({
      type: "browser_navigate",
      url: "https://example.com",
    });
    expect(client.controls).toEqual(["pause"]);
  });

  it("runs ordered pipelines and stops on the first failed step", async () => {
    const client = new FakeRelayClient();
    const gateway = new AgentGateway({}, client);

    const result = await gateway.execute("browser_run_pipeline", {
      steps: [
        { tool: "browser_snapshot" },
        { tool: "unknown_tool" },
        { tool: "browser_scroll", arguments: { direction: "down", amount: 320 } },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.completed_steps).toBe(2);
    expect(client.actions).toHaveLength(1);
  });

  it("serves the same manifest and calls through the JSONL dispatcher", async () => {
    const client = new FakeRelayClient();
    const gateway = new AgentGateway({}, client);
    const manifest = await dispatchJsonlRequest(gateway, { method: "tools/list" });
    const result = await dispatchJsonlRequest(gateway, {
      id: 9,
      method: "tools/call",
      params: { name: "browser_keypress", arguments: { key: "Enter" } },
    });

    expect(manifest.tools).toHaveLength(27);
    expect(result.executed).toBe("browser_keypress");
  });

  it("reports required arguments before sending an action", async () => {
    const client = new FakeRelayClient();
    const gateway = new AgentGateway({}, client);

    await expect(gateway.execute("browser_type", {})).rejects.toThrow(
      "browser_type requires argument: text"
    );
    expect(client.actions).toHaveLength(0);
  });
});
