import { NATIVE_HOST_NAME } from "../shared/constants.js";

export class NativeBridgePort {
  private port: chrome.runtime.Port | null = null;
  private messageListeners: ((msg: any) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];

  public connect(): boolean {
    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.port.onMessage.addListener((msg) => {
        for (const listener of this.messageListeners) {
          listener(msg);
        }
      });
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        for (const listener of this.disconnectListeners) {
          listener();
        }
      });
      return true;
    } catch {
      this.port = null;
      return false;
    }
  }

  public send(msg: any): boolean {
    if (!this.port) {
      return false;
    }
    this.port.postMessage(msg);
    return true;
  }

  public onMessage(listener: (msg: any) => void): void {
    this.messageListeners.push(listener);
  }

  public onDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener);
  }

  public isConnected(): boolean {
    return this.port !== null;
  }
}
