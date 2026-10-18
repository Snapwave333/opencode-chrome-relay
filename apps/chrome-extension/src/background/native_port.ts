import { NATIVE_HOST_NAME, DEFAULT_BROKER_URL } from "../shared/constants.js";

export class NativeBridgePort {
  private ws: WebSocket | null = null;
  private port: chrome.runtime.Port | null = null;
  private pendingQueue: string[] = [];
  private messageListeners: ((msg: any) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private authToken: string | null = null;
  private authTokenRequested = false;

  public async connect(): Promise<boolean> {
    this.startKeepAlive();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return true;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Get auth token before connecting
    if (!this.authToken && !this.authTokenRequested) {
      this.authTokenRequested = true;
      await this.fetchAuthToken();
    }
    
    try {
      const ws = new WebSocket(DEFAULT_BROKER_URL);
      this.ws = ws;
      ws.onopen = () => {
        // Send auth token immediately after connection
        if (this.authToken) {
          ws.send(JSON.stringify({ auth_token: this.authToken }));
        }
        
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
        // BUG-016 fix: Clear existing timer before setting new one
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1500);
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

  private async fetchAuthToken(): Promise<void> {
    try {
      // Try to get token from storage first (may have been set via native host)
      const stored = await chrome.storage.local.get('relay_auth_token');
      if (stored?.relay_auth_token) {
        this.authToken = stored.relay_auth_token;
        return;
      }

      // Request token from native host
      await this.requestTokenFromNativeHost();
    } catch (err) {
      console.error('Failed to fetch auth token:', err);
      // Continue without token - broker will reject but extension stays functional
    }
  }

  private async requestTokenFromNativeHost(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            port.disconnect();
            resolve();
          }
        }, 2000);

        port.onMessage.addListener((msg: any) => {
          if (!resolved && msg?.auth_token) {
            resolved = true;
            clearTimeout(timeout);
            this.authToken = msg.auth_token;
            // Cache in storage for future use
            chrome.storage.local.set({ relay_auth_token: msg.auth_token }).catch(() => {});
            port.disconnect();
            resolve();
          }
        });

        port.onDisconnect.addListener(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve();
          }
        });

        // Request token
        port.postMessage({ request: 'get_auth_token' });
      } catch (err) {
        console.error('Failed to connect to native host for token:', err);
        resolve();
      }
    });
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
