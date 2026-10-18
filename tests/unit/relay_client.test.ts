import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { RelayBrokerClient } from "../../packages/opencode-plugin/src/client.js";

describe("RelayBrokerClient", () => {
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
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

  it("waits for authentication and the correlated finished event", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Missing server port");

    let receivedEvent = "";
    server.on("connection", (socket) => {
      socket.on("message", (buffer) => {
        const message = JSON.parse(buffer.toString());
        if (message.auth_token) {
          socket.send(JSON.stringify({ event: "bridge.connected", status: "authenticated" }));
          return;
        }
        receivedEvent = message.event;
        socket.send(
          JSON.stringify({
            event: "action.started",
            run_id: message.run_id,
            idempotency_key: message.idempotency_key,
            payload: { accepted: true },
          })
        );
        setTimeout(
          () =>
            socket.send(
              JSON.stringify({
                event: "action.finished",
                run_id: message.run_id,
                idempotency_key: message.idempotency_key,
                payload: { executed: true },
              })
            ),
          25
        );
      });
    });

    const client = new RelayBrokerClient({
      brokerUrl: `ws://127.0.0.1:${address.port}`,
      authToken: "test-token",
      runId: "run_client_test",
    });
    await client.connect();
    const startedAt = Date.now();
    const result = await client.sendAction({
      type: "browser_snapshot",
      risk: "read_only",
      is_irreversible: false,
    });

    expect(receivedEvent).toBe("browser.action.request");
    expect(result).toEqual({ executed: true });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    client.disconnect();
  });

  it("rejects an invalid broker token", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Missing server port");

    server.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ error: "Unauthorized" }));
      });
    });

    const client = new RelayBrokerClient({
      brokerUrl: `ws://127.0.0.1:${address.port}`,
      authToken: "wrong-token",
    });

    await expect(client.connect()).rejects.toThrow("authentication failed");
    client.disconnect();
  });

  it("rejects in-flight actions when the broker connection drops", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Missing server port");

    server.on("connection", (socket) => {
      socket.on("message", () => socket.terminate());
    });

    const client = new RelayBrokerClient({ brokerUrl: `ws://127.0.0.1:${address.port}`, runId: "run_drop" });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    await expect(client.sendAction({ type: "browser_snapshot" } as any)).rejects.toThrow(/connection closed/);
    expect(client.isConnected()).toBe(false);
  });

  it("rejects actions the broker marks as forbidden", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Missing server port");

    server.on("connection", (socket) => {
      socket.on("message", (buffer) => {
        const message = JSON.parse(buffer.toString());
        socket.send(
          JSON.stringify({
            event: "action.started",
            run_id: message.run_id,
            idempotency_key: message.idempotency_key,
            payload: { is_forbidden: true, reason: "restricted target" },
          })
        );
      });
    });

    const client = new RelayBrokerClient({ brokerUrl: `ws://127.0.0.1:${address.port}`, runId: "run_forbid" });
    await client.connect();
    await expect(
      client.sendAction({ type: "browser_navigate", url: "chrome://settings" } as any)
    ).rejects.toThrow(/restricted target/);
    client.disconnect();
  });

  it("ignores epoch updates broadcast for other runs", async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Missing server port");

    server.on("connection", (socket) => {
      socket.send(
        JSON.stringify({ event: "run.state_changed", run_id: "run_other", epoch: 7, payload: { new_state: "stopped" } })
      );
      socket.send(
        JSON.stringify({ event: "run.state_changed", run_id: "run_mine", epoch: 2, payload: { new_state: "ready" } })
      );
    });

    const client = new RelayBrokerClient({ brokerUrl: `ws://127.0.0.1:${address.port}`, runId: "run_mine" });
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(client.getEpoch()).toBe(2);
    client.disconnect();
  });
});
