import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  ProtocolEnvelope,
  ActionPayload,
  ControlCommand,
} from "@opencode/chrome-relay-protocol";

export interface RelayClientOptions {
  brokerUrl?: string;
  authToken?: string;
  runId?: string;
  isolateTab?: boolean;
  isolatedTabUrl?: string;
}

const TAB_AGNOSTIC_ACTIONS = new Set<ActionPayload["type"]>([
  "browser_list_tabs",
  "browser_new_tab",
  "browser_status",
  "browser_switch_tab",
]);

function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value || "").trim());
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
  private readonly instanceId = randomUUID().slice(0, 8);
  private readonly isolateTab: boolean;
  private readonly isolatedTabUrl: string;
  private dedicatedTabId: number | null = null;
  private dedicatedTabRequest: Promise<number> | null = null;

  constructor(options: RelayClientOptions = {}) {
    this.brokerUrl = options.brokerUrl || process.env.RELAY_BROKER_URL || "ws://127.0.0.1:4098";
    this.authToken = options.authToken || process.env.RELAY_AUTH_TOKEN || "";
    this.runId = options.runId || process.env.RELAY_RUN_ID || `run_${randomUUID()}`;
    this.isolateTab = options.isolateTab ?? envFlag(process.env.RELAY_ISOLATE_TAB);
    this.isolatedTabUrl = options.isolatedTabUrl || process.env.RELAY_ISOLATED_TAB_URL || "about:blank";
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
    let targetTabId = tabId ?? this.tabId;
    if (this.isolateTab && targetTabId == null && !TAB_AGNOSTIC_ACTIONS.has(action.type)) {
      targetTabId = await this.ensureDedicatedTab();
    }
    if (this.isolateTab && (action.type === "browser_navigate" || action.type === "browser_new_tab")) {
      action = { ...action, background: action.background ?? true };
    }
    return this.dispatch(action, targetTabId ?? undefined);
  }

  public async ensureDedicatedTab(): Promise<number> {
    if (this.dedicatedTabId != null) return this.dedicatedTabId;
    if (!this.dedicatedTabRequest) {
      this.dedicatedTabRequest = this.dispatch({
        type: "browser_new_tab",
        url: this.isolatedTabUrl,
        background: true,
      } as ActionPayload)
        .then((outcome) => {
          const created = Number(outcome?.tab_id);
          if (!Number.isInteger(created) || created <= 0) {
            throw new Error("Relay did not return a tab id for the dedicated agent tab");
          }
          this.dedicatedTabId = created;
          this.setTabBinding(created, `lease_${this.runId}_${created}`);
          return created;
        })
        .finally(() => {
          this.dedicatedTabRequest = null;
        });
    }
    return this.dedicatedTabRequest;
  }

  public async releaseDedicatedTab(): Promise<void> {
    const tabId = this.dedicatedTabId;
    if (tabId == null) return;
    this.dedicatedTabId = null;
    if (this.tabId === tabId) {
      this.tabId = null;
      this.leaseId = null;
    }
    await this.dispatch({ type: "browser_close_tab" } as ActionPayload, tabId).catch(() => undefined);
  }

  private async dispatch(action: ActionPayload, targetTabId?: number): Promise<any> {
    this.sequence += 1;
    const idempotencyKey = `${this.runId}:${this.instanceId}:${this.epoch}:${this.sequence}`;

    const envelope: ProtocolEnvelope = {
      v: 1,
      event: "browser.action.request",
      event_id: `evt_${Date.now()}_${this.sequence}`,
      run_id: this.runId,
      epoch: this.epoch,
      sequence: this.sequence,
      tab_id: targetTabId ?? undefined,
      lease_id:
        targetTabId != null && targetTabId === this.tabId && this.leaseId
          ? this.leaseId
          : `lease_${this.runId}_${targetTabId ?? "none"}`,
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

  public getTabId(): number | null {
    return this.tabId;
  }

  public isTabIsolated(): boolean {
    return this.isolateTab;
  }
}
