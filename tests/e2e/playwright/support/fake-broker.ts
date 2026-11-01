import { randomUUID } from "crypto";
import { WebSocketServer, type WebSocket } from "ws";

export type Envelope = Record<string, any>;

interface Frame {
  socket: WebSocket;
  data: Envelope;
}

interface Waiter {
  match: (frame: Frame) => boolean;
  resolve: (frame: Frame) => void;
}

export class FakeBroker {
  readonly frames: Frame[] = [];
  private readonly sockets = new Set<WebSocket>();
  private waiters: Waiter[] = [];
  private sequence = 0;

  private constructor(private readonly server: WebSocketServer) {
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("message", (raw) => {
        let data: Envelope;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const frame = { socket, data };
        this.frames.push(frame);
        this.waiters = this.waiters.filter((waiter) => {
          if (!waiter.match(frame)) return true;
          waiter.resolve(frame);
          return false;
        });
      });
    });
  }

  static async start(port: number): Promise<FakeBroker | null> {
    const server = new WebSocketServer({ host: "127.0.0.1", port });
    const listening = await new Promise<boolean>((resolve) => {
      server.once("listening", () => resolve(true));
      server.once("error", () => resolve(false));
    });
    if (!listening) {
      server.close();
      return null;
    }
    return new FakeBroker(server);
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  waitForFrame(match: (frame: Frame) => boolean, timeoutMs = 10_000, sinceIndex = 0): Promise<Frame> {
    const existing = this.frames.slice(sinceIndex).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise<Frame>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`fake broker: no matching frame within ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(socket: WebSocket, envelope: Envelope): void {
    socket.send(
      JSON.stringify({
        v: 1,
        event_id: `evt_e2e_${randomUUID()}`,
        timestamp: new Date().toISOString(),
        ...envelope,
      })
    );
  }

  async dispatch(
    socket: WebSocket,
    action: Envelope,
    options: { tabId?: number; runId?: string; idempotencyKey?: string; timeoutMs?: number } = {}
  ): Promise<Envelope> {
    const key = options.idempotencyKey ?? `idem_${randomUUID()}`;
    const result = this.waitForFrame(
      (f) =>
        f.socket === socket &&
        f.data.idempotency_key === key &&
        (f.data.event === "action.finished" || f.data.event === "action.failed"),
      options.timeoutMs ?? 15_000
    );
    this.send(socket, {
      event: "action.started",
      run_id: options.runId ?? "run_e2e",
      epoch: 0,
      sequence: ++this.sequence,
      idempotency_key: key,
      tab_id: options.tabId,
      action,
    });
    return (await result).data;
  }

  async findClientByTabUrl(url: string, timeoutMs = 15_000): Promise<{ socket: WebSocket; tabId: number }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const socket of [...this.sockets]) {
        const reply = await this.dispatch(socket, { type: "browser_list_tabs" }, { timeoutMs: 3_000 }).catch(
          () => null
        );
        const tab = reply?.payload?.tabs?.find((t: { url: string }) => t.url === url);
        if (tab?.id) return { socket, tabId: tab.id };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`fake broker: no extension client has a tab at ${url}`);
  }

  dropClients(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
