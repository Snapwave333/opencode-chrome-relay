import WebSocket from "ws";
import {
  ProtocolEnvelope,
  ActionPayload,
  ControlCommand,
} from "@opencode/chrome-relay-protocol";

export interface RelayClientOptions {
  brokerUrl?: string;
  authToken?: string;
  runId?: string;
}

export class RelayBrokerClient {
  private ws: WebSocket | null = null;
  private brokerUrl: string;
  private authToken: string;
  private runId: string;
  private epoch = 0;
  private sequence = 0;
  private tabId: number | null = null;
  private leaseId: string | null = null;
  private eventHandlers: Map<string, ((payload: any) => void)[]> = new Map();

  constructor(options: RelayClientOptions = {}) {
    this.brokerUrl = options.brokerUrl || process.env.RELAY_BROKER_URL || "ws://127.0.0.1:4098";
    this.authToken = options.authToken || this.loadAuthToken();
    this.runId = options.runId || `run_${Date.now()}`;
  }

  private loadAuthToken(): string {
    // Check environment variable first
    if (process.env.RELAY_AUTH_TOKEN) {
      return process.env.RELAY_AUTH_TOKEN;
    }

    // Try to read from config file
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      let configDir: string;
      if (process.platform === 'win32') {
        configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opencode-relay');
      } else {
        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        configDir = path.join(xdgConfig, 'opencode-relay');
      }
      
      const tokenFile = path.join(configDir, 'auth-token');
      if (fs.existsSync(tokenFile)) {
        return fs.readFileSync(tokenFile, 'utf-8').trim();
      }
    } catch (err) {
      // Silently fail - will try to connect without token
    }

    return "";
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.brokerUrl);
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };
        const timeout = setTimeout(
          () => finish(new Error("Timed out connecting to the relay broker")),
          5000
        );

        this.ws.on("open", () => {
          if (this.authToken) {
            this.ws?.send(JSON.stringify({ auth_token: this.authToken }));
          } else {
            finish();
          }
        });

        this.ws.on("message", (data: WebSocket.RawData) => {
          try {
            const raw = JSON.parse(data.toString());
            this.handleIncoming(raw);
            if (this.authToken && raw.event === "bridge.connected") finish();
            if (raw.error === "Unauthorized") finish(new Error("Relay broker authentication failed"));
          } catch {
            // Ignore non-json
          }
        });

        this.ws.on("error", (err) => {
          finish(err);
        });

        this.ws.on("close", () => {
          if (!settled) finish(new Error("Relay broker closed before authentication completed"));
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public on(event: string, handler: (payload: any) => void): void {
    const list = this.eventHandlers.get(event) || [];
    list.push(handler);
    this.eventHandlers.set(event, list);
  }

  private handleIncoming(data: any): void {
    if (data.event) {
      const handlers = this.eventHandlers.get(data.event);
      if (handlers) {
        handlers.forEach((fn) => fn(data));
      }
      if (data.event === "run.state_changed" && data.payload?.new_state) {
        if (data.epoch !== undefined) {
          this.epoch = data.epoch;
        }
      }
    }
  }

  public async sendAction(action: ActionPayload, tabId?: number): Promise<any> {
    const targetTabId = tabId ?? this.tabId;
    this.sequence += 1;
    const idempotencyKey = `${this.runId}:${this.epoch}:${this.sequence}`;

    const envelope: ProtocolEnvelope = {
      v: 1,
      event: "browser.action.request",
      event_id: `evt_${Date.now()}_${this.sequence}`,
      run_id: this.runId,
      epoch: this.epoch,
      sequence: this.sequence,
      tab_id: targetTabId ?? undefined,
      lease_id: this.leaseId ?? `lease_${this.runId}`,
      idempotency_key: idempotencyKey,
      timestamp: new Date().toISOString(),
      action,
    };

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("Relay broker WebSocket is not connected"));
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Action timeout waiting for broker response (${action.type})`));
      }, Math.max(action.timeout_ms || 30000, 10000));

      const responseHandler = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.idempotency_key === idempotencyKey) {
            if (parsed.event === "action.finished") {
              clearTimeout(timeout);
              this.ws?.off("message", responseHandler);
              resolve(parsed.payload || parsed);
            } else if (parsed.event === "action.failed" || parsed.error) {
              clearTimeout(timeout);
              this.ws?.off("message", responseHandler);
              reject(new Error(parsed.payload?.error || parsed.error || "Action execution failed"));
            } else if (parsed.event === "approval.requested") {
              clearTimeout(timeout);
              this.ws?.off("message", responseHandler);
              resolve({
                requires_approval: true,
                reason: parsed.payload?.reason,
                status: "waiting_for_user_approval",
              });
            }
          }
        } catch {
          // Ignore
        }
      };

      this.ws.on("message", responseHandler);
      this.ws.send(JSON.stringify(envelope));
    });
  }

  public async sendControl(command: ControlCommand["command"], instruction?: string): Promise<any> {
    const cmd: ControlCommand = {
      command,
      run_id: this.runId,
      epoch: this.epoch,
      instruction,
    };

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("Relay broker WebSocket is not connected"));
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Control command timeout (${command})`));
      }, 5000);

      const responseHandler = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.event === "run.state_changed" && parsed.run_id === this.runId) {
            clearTimeout(timeout);
            this.ws?.off("message", responseHandler);
            if (parsed.epoch !== undefined) {
              this.epoch = parsed.epoch;
            }
            resolve(parsed.payload);
          } else if (parsed.error && parsed.run_id === this.runId) {
            clearTimeout(timeout);
            this.ws?.off("message", responseHandler);
            reject(new Error(parsed.error));
          }
        } catch {
          // Ignore
        }
      };

      this.ws.on("message", responseHandler);
      this.ws.send(JSON.stringify(cmd));
    });
  }

  public setTabBinding(tabId: number, leaseId: string): void {
    this.tabId = tabId;
    this.leaseId = leaseId;
  }

  public getRunId(): string {
    return this.runId;
  }

  public getEpoch(): number {
    return this.epoch;
  }
}
