import { keyToCDPKeyEvent } from "../browser/actions.js";

export class CDPController {
  private onDetachHandler?: (tabId: number) => void;

  public setOnDetachHandler(handler: (tabId: number) => void): void {
    this.onDetachHandler = handler;
  }

  public async sendCommand(tabId: number, method: string, params?: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`CDP command ${method} timed out`));
      }, 5000);
      try {
        chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            const errStr = chrome.runtime.lastError.message || "CDP error";
            if (/not attached/i.test(errStr) && this.onDetachHandler) {
              this.onDetachHandler(tabId);
            }
            reject(new Error(errStr));
          } else {
            resolve(result);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  public async navigate(tabId: number, url: string): Promise<any> {
    return this.sendCommand(tabId, "Page.navigate", { url });
  }

  public async click(tabId: number, x: number, y: number): Promise<void> {
    // Mouse moved
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    // Mouse pressed
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    // Mouse released
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  public async type(tabId: number, text: string): Promise<void> {
    for (const char of text) {
      await this.sendCommand(tabId, "Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        key: char,
      });
      await this.sendCommand(tabId, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: char,
      });
    }
  }

  public async keypress(tabId: number, key: string): Promise<void> {
    const keyEvent = keyToCDPKeyEvent(key);
    await this.sendCommand(tabId, "Input.dispatchKeyEvent", keyEvent);
    await this.sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyEvent.key,
      code: keyEvent.code,
    });
  }

  public async captureScreenshot(tabId: number): Promise<string> {
    try {
      await this.sendCommand(tabId, "Page.enable");
    } catch {}
    try {
      const result = await this.sendCommand(tabId, "Page.captureScreenshot", { format: "png", fromSurface: true });
      if (result?.data) return result.data;
    } catch {}
    const fallback = await this.sendCommand(tabId, "Page.captureScreenshot", { format: "png" });
    return fallback?.data || "";
  }

  public async evaluate(tabId: number, expression: string): Promise<any> {
    const result = await this.sendCommand(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result?.result?.value;
  }

  public async setDownloadBehavior(tabId: number, downloadPath: string): Promise<void> {
    try {
      await this.sendCommand(tabId, "Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath,
      });
    } catch {
      // Page domain may require Browser domain
    }
  }

  public async setFileInputFiles(tabId: number, selector: string, files: string[]): Promise<boolean> {
    try {
      const doc = await this.sendCommand(tabId, "DOM.getDocument");
      const rootNodeId = doc?.root?.nodeId;
      if (!rootNodeId) return false;

      const node = await this.sendCommand(tabId, "DOM.querySelector", {
        nodeId: rootNodeId,
        selector,
      });

      if (!node?.nodeId) return false;

      await this.sendCommand(tabId, "DOM.setFileInputFiles", {
        nodeId: node.nodeId,
        files,
      });

      // Dispatch change and input events on input element
      await this.evaluate(
        tabId,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`
      );

      return true;
    } catch {
      return false;
    }
  }
}
