import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const repoRoot = path.resolve(__dirname, "../..");
const binaryName = process.platform === "win32" ? "relay-broker.exe" : "relay-broker";
const brokerBinary = [
  path.join(repoRoot, "target", "debug", binaryName),
  path.join(repoRoot, "target", "release", binaryName),
].find((candidate) => fs.existsSync(candidate));

const AUTH_TOKEN = "live-test-token";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

class Peer {
  readonly messages: any[] = [];
  private waiters: Array<{ match: (m: any) => boolean; resolve: (m: any) => void }> = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.messages.push(parsed);
      this.waiters = this.waiters.filter((waiter) => {
        if (!waiter.match(parsed)) return true;
        waiter.resolve(parsed);
        return false;
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  next(match: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
    const existing = this.messages.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for broker message")), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  close(): void {
    this.ws.terminate();
  }
}

describe.skipIf(!brokerBinary)("relay broker (live binary)", () => {
  let broker: ChildProcess;
  let url = "";
  let dataDir = "";
  const peers: Peer[] = [];

  async function connect(options: { origin?: string; authenticate?: boolean } = {}): Promise<Peer> {
    const ws = new WebSocket(url, options.origin ? { headers: { Origin: options.origin } } : {});
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    const peer = new Peer(ws);
    peers.push(peer);
    if (options.authenticate !== false) {
      peer.send({ auth_token: AUTH_TOKEN });
      await peer.next((m) => m.event === "bridge.connected");
    }
    return peer;
  }

  beforeAll(async () => {
    const port = await freePort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-broker-live-"));
    url = `ws://127.0.0.1:${port}`;
    broker = spawn(brokerBinary!, [], {
      env: {
        ...process.env,
        RELAY_PORT: String(port),
        RELAY_HOST: "127.0.0.1",
        RELAY_AUTH_TOKEN: AUTH_TOKEN,
        RELAY_DB_PATH: path.join(dataDir, "relay.sqlite"),
      },
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      const ready = await new Promise<boolean>((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (ready) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Broker did not start listening");
  }, 15000);

  afterAll(() => {
    peers.forEach((peer) => peer.close());
    broker?.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects WebSocket upgrades from foreign web origins", async () => {
    await expect(connect({ origin: "https://evil.example" })).rejects.toThrow(/403/);
  });

  it("accepts the extension origin", async () => {
    const peer = await connect({ origin: "chrome-extension://abcdefghijklmnop" });
    expect(peer.messages.some((m) => m.event === "bridge.connected")).toBe(true);
  });

  it("withholds broadcasts from unauthenticated sockets", async () => {
    const lurker = await connect({ authenticate: false });
    const sender = await connect();
    sender.send({
      v: 1,
      event: "session.create",
      event_id: "evt_lurk",
      timestamp: new Date().toISOString(),
      run_id: "run_lurk",
      payload: { name: "Lurk" },
    });
    await sender.next((m) => m.event === "session.created" && m.run_id === "run_lurk");
    await new Promise((r) => setTimeout(r, 150));
    expect(lurker.messages).toEqual([]);
  });

  it("answers forbidden navigation with action.failed and never dispatches it", async () => {
    const extension = await connect();
    const agent = await connect();
    agent.send({
      v: 1,
      event: "browser.action.request",
      event_id: "evt_forbid",
      timestamp: new Date().toISOString(),
      run_id: "run_forbid",
      epoch: 0,
      sequence: 1,
      idempotency_key: "run_forbid:0:1",
      action: { type: "browser_navigate", url: "chrome://settings/passwords" },
    });
    const failed = await agent.next((m) => m.idempotency_key === "run_forbid:0:1");
    expect(failed.event).toBe("action.failed");
    expect(failed.payload.is_forbidden).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(extension.messages.some((m) => m.event === "action.started" && m.run_id === "run_forbid")).toBe(false);
  });

  it("refuses to relay a client action.started that needs approval", async () => {
    const extension = await connect();
    const agent = await connect();
    agent.send({
      v: 1,
      event: "action.started",
      event_id: "evt_bypass",
      timestamp: new Date().toISOString(),
      run_id: "run_bypass",
      epoch: 0,
      idempotency_key: "run_bypass:0:1",
      action: { type: "browser_click", locator: { name: "Delete account" } },
    });
    const reply = await agent.next((m) => m.idempotency_key === "run_bypass:0:1");
    expect(reply.error).toMatch(/sensitive/i);
    await new Promise((r) => setTimeout(r, 150));
    expect(extension.messages.some((m) => m.run_id === "run_bypass")).toBe(false);
  });

  it("delivers each reply to its sender exactly once", async () => {
    const agent = await connect();
    agent.send({
      v: 1,
      event: "browser.action.request",
      event_id: "evt_once",
      timestamp: new Date().toISOString(),
      run_id: "run_once",
      epoch: 0,
      sequence: 1,
      idempotency_key: "run_once:0:1",
      action: { type: "browser_snapshot" },
    });
    await agent.next((m) => m.event === "action.started" && m.idempotency_key === "run_once:0:1");
    await new Promise((r) => setTimeout(r, 200));
    expect(agent.messages.filter((m) => m.idempotency_key === "run_once:0:1")).toHaveLength(1);
  });

  it("echoes the advanced epoch after a stop so clients stay in sync", async () => {
    const agent = await connect();
    agent.send({ command: "stop", run_id: "run_epoch", epoch: 0 });
    const changed = await agent.next((m) => m.event === "run.state_changed" && m.run_id === "run_epoch");
    expect(changed.epoch).toBe(1);
    expect(changed.payload.new_state).toBe("STOPPED");
  });

  it("keeps the connection open after a malformed frame", async () => {
    const agent = await connect();
    agent.ws.send("not json");
    const err = await agent.next((m) => m.error === "Invalid JSON message");
    expect(err).toBeDefined();
    agent.send({ v: 1, event: "session.list", event_id: "evt_list", timestamp: new Date().toISOString() });
    const list = await agent.next((m) => m.event === "session.list");
    expect(Array.isArray(list.payload.sessions)).toBe(true);
  });
});
