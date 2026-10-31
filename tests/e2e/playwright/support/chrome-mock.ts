import type { Page } from "@playwright/test";

export type RelayMessage = Record<string, any>;

export interface ChromeMockConfig {
  responses?: Record<string, unknown>;
  openShadowRoots?: boolean;
}

declare global {
  interface Window {
    __relay: {
      sent: RelayMessage[];
      listeners: Array<(msg: RelayMessage, sender: unknown, respond: (r?: unknown) => void) => unknown>;
      emit: (msg: RelayMessage) => void;
    };
  }
}

function installChromeMock(config: ChromeMockConfig): void {
  const responses = config.responses ?? {};
  const sent: RelayMessage[] = [];
  const listeners: Window["__relay"]["listeners"] = [];

  window.__relay = {
    sent,
    listeners,
    emit: (msg) => listeners.slice().forEach((listener) => listener(msg, { id: "mock" }, () => undefined)),
  };

  const respondTo = (msg: RelayMessage) =>
    msg && Object.prototype.hasOwnProperty.call(responses, msg.type) ? responses[msg.type] : { success: true };

  (window as any).chrome = {
    runtime: {
      id: "mock-extension-id",
      lastError: undefined,
      sendMessage(msg: RelayMessage, callback?: (response: unknown) => void) {
        sent.push(JSON.parse(JSON.stringify(msg)));
        const response = respondTo(msg);
        if (typeof callback === "function") {
          queueMicrotask(() => callback(response));
          return undefined;
        }
        return Promise.resolve(response);
      },
      onMessage: {
        addListener: (listener: Window["__relay"]["listeners"][number]) => listeners.push(listener),
        removeListener: (listener: Window["__relay"]["listeners"][number]) => {
          const index = listeners.indexOf(listener);
          if (index !== -1) listeners.splice(index, 1);
        },
        hasListeners: () => listeners.length > 0,
      },
    },
  };

  if (config.openShadowRoots) {
    const nativeAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return nativeAttachShadow.call(this, { ...init, mode: "open" });
    };
  }
}

export class RelayHarness {
  constructor(private readonly page: Page) {}

  async install(config: ChromeMockConfig = {}): Promise<void> {
    await this.page.addInitScript(installChromeMock, config);
  }

  async emit(message: RelayMessage): Promise<void> {
    await this.page.evaluate((msg) => window.__relay.emit(msg), message);
  }

  async sent(): Promise<RelayMessage[]> {
    return this.page.evaluate(() => window.__relay.sent);
  }

  async sentOfType(type: string): Promise<RelayMessage[]> {
    return (await this.sent()).filter((msg) => msg.type === type);
  }

  async lastSent(): Promise<RelayMessage | undefined> {
    return (await this.sent()).at(-1);
  }

  async listenerCount(): Promise<number> {
    return this.page.evaluate(() => window.__relay.listeners.length);
  }
}
