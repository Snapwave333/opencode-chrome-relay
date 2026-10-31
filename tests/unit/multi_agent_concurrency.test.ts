import { afterEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { RelayBrokerClient } from "../../packages/opencode-plugin/src/client.js";
import { applyBackgroundPreference, parseCliArgs } from "../../packages/opencode-plugin/src/cli.js";
import { resolveJsonlConcurrency, runJsonlGateway } from "../../packages/agent-gateway/src/jsonl.js";

interface Received {
  event: string;
  run_id: string;
  tab_id?: number;
  lease_id?: string;
  idempotency_key: string;
  action: { type: string; url?: string; background?: boolean };
}

const servers: WebSocketServer[] = [];

afterEach(async () => {
  delete process.env.RELAY_RUN_ID;
  delete process.env.RELAY_TAB_ID;
  delete process.env.RELAY_BACKGROUND;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) client.terminate();
          server.close(() => resolve());
        })
    )
  );
});

async function fakeBroker(newTabId = 77) {
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  const received: Received[] = [];

  server.on("connection", (socket) => {
    socket.on("message", (buffer) => {
      const msg = JSON.parse(buffer.toString()) as Received;
      received.push(msg);
      const payload =
        msg.action.type === "browser_new_tab"
          ? { success: true, tab_id: newTabId }
          : { success: true, tab_id: msg.tab_id ?? null };
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({ event: "action.finished", idempotency_key: msg.idempotency_key, payload })
          ),
        10
      );
    });
  });

  return { url: `ws://127.0.0.1:${address.port}`, received };
}

describe("relay client identity under concurrency", () => {
  it("gives each client a collision-free run id and idempotency keys", () => {
    const ids = new Set(Array.from({ length: 200 }, () => new RelayBrokerClient().getRunId()));
    expect(ids.size).toBe(200);
  });

  it("honours RELAY_RUN_ID and still keeps keys unique across processes sharing it", async () => {
    process.env.RELAY_RUN_ID = "pipeline_checkout";
    const broker = await fakeBroker();
    const first = new RelayBrokerClient({ brokerUrl: broker.url });
    const second = new RelayBrokerClient({ brokerUrl: broker.url });
    expect(first.getRunId()).toBe("pipeline_checkout");
    expect(second.getRunId()).toBe("pipeline_checkout");

    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([
      first.sendAction({ type: "browser_snapshot" } as any, 5),
      second.sendAction({ type: "browser_snapshot" } as any, 6),
    ]);
    first.disconnect();
    second.disconnect();

    const keys = broker.received.map((m) => m.idempotency_key);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith("pipeline_checkout:"))).toBe(true);
  });
});

describe("dedicated tab isolation", () => {
  it("opens exactly one background tab for concurrent first actions and pins every action to it", async () => {
    const broker = await fakeBroker(77);
    const client = new RelayBrokerClient({ brokerUrl: broker.url, isolateTab: true, runId: "run_agent" });
    await client.connect();

    const results = await Promise.all([
      client.sendAction({ type: "browser_snapshot" } as any),
      client.sendAction({ type: "browser_navigate", url: "https://example.com" } as any),
      client.sendAction({ type: "browser_click", locator: { selector: "#go" } } as any),
    ]);
    client.disconnect();

    const newTabs = broker.received.filter((m) => m.action.type === "browser_new_tab");
    expect(newTabs).toHaveLength(1);
    expect(newTabs[0].action).toMatchObject({ url: "about:blank", background: true });

    const scoped = broker.received.filter((m) => m.action.type !== "browser_new_tab");
    expect(scoped).toHaveLength(3);
    for (const msg of scoped) {
      expect(msg.tab_id).toBe(77);
      expect(msg.lease_id).toBe("lease_run_agent_77");
    }
    expect(scoped.find((m) => m.action.type === "browser_navigate")?.action.background).toBe(true);
    expect(results.map((r) => r.tab_id)).toEqual([77, 77, 77]);
    expect(client.getTabId()).toBe(77);
  });

  it("does not open a tab for tab-agnostic actions or when a tab is given explicitly", async () => {
    const broker = await fakeBroker();
    const client = new RelayBrokerClient({ brokerUrl: broker.url, isolateTab: true });
    await client.connect();
    await client.sendAction({ type: "browser_list_tabs" } as any);
    await client.sendAction({ type: "browser_status" } as any);
    await client.sendAction({ type: "browser_snapshot" } as any, 12);
    client.disconnect();

    expect(broker.received.map((m) => m.action.type)).toEqual([
      "browser_list_tabs",
      "browser_status",
      "browser_snapshot",
    ]);
    expect(broker.received[2].tab_id).toBe(12);
  });

  it("closes the dedicated tab on release", async () => {
    const broker = await fakeBroker(91);
    const client = new RelayBrokerClient({ brokerUrl: broker.url, isolateTab: true });
    await client.connect();
    await client.ensureDedicatedTab();
    await client.releaseDedicatedTab();
    client.disconnect();

    const close = broker.received.find((m) => m.action.type === "browser_close_tab");
    expect(close?.tab_id).toBe(91);
    expect(client.getTabId()).toBeNull();
  });

  it("leaves non-isolated clients on the active tab as before", async () => {
    const broker = await fakeBroker();
    const client = new RelayBrokerClient({ brokerUrl: broker.url, isolateTab: false });
    await client.connect();
    await client.sendAction({ type: "browser_navigate", url: "https://example.com" } as any);
    client.disconnect();

    expect(broker.received).toHaveLength(1);
    expect(broker.received[0].tab_id).toBeUndefined();
    expect(broker.received[0].action.background).toBeUndefined();
  });
});

describe("JSONL gateway concurrency", () => {
  async function measure(concurrency: number) {
    let active = 0;
    let peak = 0;
    const gateway = {
      execute: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        return { ok: true };
      },
      listTools: () => [],
      shutdown: async () => undefined,
    };
    const lines: string[] = [];
    const requests = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ id: i, method: "tools/call", params: { name: "browser_snapshot" } })
    ).join("\n");

    await runJsonlGateway({
      gateway: gateway as any,
      input: Readable.from([`${requests}\n`]),
      write: (line) => lines.push(line),
      concurrency,
    });

    const ids = lines.map((l) => JSON.parse(l).id).sort();
    return { peak, ids };
  }

  it("processes independent requests in parallel up to the limit", async () => {
    const { peak, ids } = await measure(8);
    expect(peak).toBe(5);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  it("respects a limit of 1 for strictly sequential pipelines", async () => {
    const { peak } = await measure(1);
    expect(peak).toBe(1);
  });

  it("reads the limit from RELAY_JSONL_CONCURRENCY with a safe default", () => {
    expect(resolveJsonlConcurrency("3")).toBe(3);
    expect(resolveJsonlConcurrency("0")).toBe(8);
    expect(resolveJsonlConcurrency(undefined)).toBe(8);
  });
});

describe("CLI multi-pipeline options", () => {
  it("defaults run and tab from the environment so a pipeline can pin itself once", () => {
    process.env.RELAY_RUN_ID = "pipeline_7";
    process.env.RELAY_TAB_ID = "314";
    const { options } = parseCliArgs(["snapshot"]);
    expect(options.runId).toBe("pipeline_7");
    expect(options.tabId).toBe(314);
  });

  it("lets explicit flags override the environment", () => {
    process.env.RELAY_TAB_ID = "314";
    const { options } = parseCliArgs(["snapshot", "--tab", "5", "--run", "manual", "--background"]);
    expect(options).toMatchObject({ tabId: 5, runId: "manual", background: true });
  });

  it("applies background only to tab-opening actions", () => {
    const opts = { background: true };
    expect(applyBackgroundPreference({ type: "browser_navigate", url: "x" } as any, opts).background).toBe(true);
    expect(applyBackgroundPreference({ type: "browser_new_tab" } as any, opts).background).toBe(true);
    expect(applyBackgroundPreference({ type: "browser_click" } as any, opts).background).toBeUndefined();
    expect(applyBackgroundPreference({ type: "browser_navigate" } as any, { background: false }).background).toBeUndefined();
  });
});
