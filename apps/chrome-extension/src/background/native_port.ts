import { NATIVE_HOST_NAME, DEFAULT_BROKER_URL } from "../shared/constants.js";

export class NativeBridgePort {
  private ws: WebSocket | null = null;
  private port: chrome.runtime.Port | null = null;
  private pendingQueue: string[] = [];
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
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      const ws = new WebSocket(DEFAULT_BROKER_URL);
      this.ws = ws;
      ws.onopen = () => {
        while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
          const item = this.pendingQueue.shift()!;
          ws.send(item);
        }
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
        }
        for (const listener of this.disconnectListeners) {
          listener();
        }
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 1500);
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
      return true;
    }
    this.pendingQueue.push(serialized);
    if (this.pendingQueue.length > 100) {
      this.pendingQueue.shift();
    }
    this.connect();
    return true;
  }

  public onMessage(listener: (msg: any) => void): void {
    this.messageListeners.push(listener);
  }

  public onDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener);
  }

  public isConnected(): boolean {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }
    this.connect();
    return this.ws !== null && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING);
  }
}
