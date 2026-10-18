import { NATIVE_HOST_NAME, DEFAULT_BROKER_URL } from "../shared/constants.js";

const AUTH_TOKEN_STORAGE_KEY = "relayAuthToken";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const NATIVE_FALLBACK_AFTER_FAILURES = 3;
const QUEUE_MAX_ITEMS = 100;
const QUEUE_MAX_ITEM_BYTES = 256 * 1024;
const QUEUE_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const QUEUE_MAX_AGE_MS = 60000;

export class NativeBridgePort {
  private ws: WebSocket | null = null;
  private port: chrome.runtime.Port | null = null;
  private pendingQueue: Array<{ data: string; queuedAt: number }> = [];
  private pendingBytes = 0;
  private failedAttempts = 0;
  private wsReady = false;
  private messageListeners: ((msg: any) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  public connect(): boolean {
    this.startKeepAlive();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return true;
    }
    if (this.reconnectTimer) {
      return this.port !== null;
    }
    try {
      const ws = new WebSocket(DEFAULT_BROKER_URL);
      this.ws = ws;
      this.wsReady = false;
      ws.onopen = () => {
        this.failedAttempts = 0;
        this.disconnectNativeFallback();
        void this.sendAuthToken(ws).finally(() => {
          if (this.ws !== ws) return;
          this.flushQueue(ws);
          this.wsReady = true;
        });
      };
      ws.onmessage = (ev) => {
        try {
          const parsed = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
          for (const listener of this.messageListeners) {
            listener(parsed);
          }
        } catch {
          // Ignore malformed frame
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.wsReady = false;
        }
        for (const listener of this.disconnectListeners) {
          listener();
        }
        this.failedAttempts++;
        if (this.failedAttempts >= NATIVE_FALLBACK_AFTER_FAILURES) {
          this.connectNativeFallback();
        }
        if (!this.reconnectTimer) {
          const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.failedAttempts - 1, 4));
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, delay);
        }
      };
      ws.onerror = () => {
        // onclose will handle reconnect
      };
      return true;
    } catch {
      this.ws = null;
      return this.connectNativeFallback();
    }
  }

  private startKeepAlive(): void {
    if (this.keepAliveInterval) return;
    this.keepAliveInterval = setInterval(() => {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo) {
          chrome.runtime.getPlatformInfo(() => {
            // Resets MV3 Service Worker 30s idle timer
          });
        }
      } catch {
        // Ignore
      }
      if (this.isSocketReady()) {
        try {
          this.ws!.send(
            JSON.stringify({
              v: 1,
              event: "bridge.heartbeat",
              event_id: `hb_${Date.now()}`,
              timestamp: new Date().toISOString(),
              payload: { from_extension: true },
            })
          );
        } catch {
          // Ignore
        }
      } else {
        this.connect();
      }
    }, 15000);
  }

  private async sendAuthToken(ws: WebSocket): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get(AUTH_TOKEN_STORAGE_KEY);
      const token = stored?.[AUTH_TOKEN_STORAGE_KEY];
      if (typeof token === "string" && token && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ auth_token: token }));
      }
    } catch {}
  }

  private flushQueue(ws: WebSocket): void {
    const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
    while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const item = this.pendingQueue.shift()!;
      this.pendingBytes -= item.data.length;
      if (item.queuedAt >= cutoff) ws.send(item.data);
    }
  }

  private disconnectNativeFallback(): void {
    if (!this.port) return;
    try {
      this.port.disconnect();
    } catch {}
    this.port = null;
  }

  private connectNativeFallback(): boolean {
    if (this.port) return true;
    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.port.onMessage.addListener((msg) => {
        for (const listener of this.messageListeners) {
          listener(msg);
        }
      });
      this.port.onDisconnect.addListener(() => {
        const _err = chrome.runtime.lastError;
        this.port = null;
      });
      return true;
    } catch {
      this.port = null;
      return false;
    }
  }

  public send(msg: any): boolean {
    const serialized = typeof msg === "string" ? msg : JSON.stringify(msg);
    if (this.isSocketReady()) {
      this.ws!.send(serialized);
      return true;
    }
    if (this.port) {
      try {
        this.port.postMessage(typeof msg === "string" ? JSON.parse(msg) : msg);
        return true;
      } catch {}
    }
    if (serialized.length > QUEUE_MAX_ITEM_BYTES) {
      this.connect();
      return false;
    }
    this.pendingQueue.push({ data: serialized, queuedAt: Date.now() });
    this.pendingBytes += serialized.length;
    while (
      this.pendingQueue.length > QUEUE_MAX_ITEMS ||
      (this.pendingBytes > QUEUE_MAX_TOTAL_BYTES && this.pendingQueue.length > 0)
    ) {
      this.pendingBytes -= this.pendingQueue.shift()!.data.length;
    }
    this.connect();
    return true;
  }

  private isSocketReady(): boolean {
    return this.wsReady && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public onMessage(listener: (msg: any) => void): void {
    this.messageListeners.push(listener);
  }

  public onDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener);
  }

  public isConnected(): boolean {
    if (this.isSocketReady() || this.port !== null) {
      return true;
    }
    this.connect();
    return this.ws !== null && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING);
  }
}
