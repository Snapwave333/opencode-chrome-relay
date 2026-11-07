import { keyToCDPKeyEvent } from "../browser/actions.js";

export class CDPController {
  private onDetachHandler?: (tabId: number) => void;

  public setOnDetachHandler(handler: (tabId: number) => void): void {
    this.onDetachHandler = handler;
  }

  public async sendCommand(tabId: number, method: string, params?: Record<string, any>, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs / 1000} s`));
      }, timeoutMs);
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

  public async mouseMove(tabId: number, x: number, y: number): Promise<void> {
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
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
      windowsVirtualKeyCode: keyEvent.windowsVirtualKeyCode,
      modifiers: keyEvent.modifiers,
    });
  }

  public async doubleClick(tabId: number, x: number, y: number): Promise<void> {
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 2,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 2,
    });
  }

  public async rightClick(tabId: number, x: number, y: number): Promise<void> {
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "right",
      clickCount: 1,
    });
    await this.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "right",
      clickCount: 1,
    });
  }

  public async captureScreenshot(tabId: number): Promise<string> {
    try {
      await this.sendCommand(tabId, "Page.enable");
    } catch {}
    try {
      const result = await this.sendCommand(tabId, "Page.captureScreenshot", { format: "png", fromSurface: true }, 7000);
      if (result?.data) return result.data;
    } catch {}
    const fallback = await this.sendCommand(tabId, "Page.captureScreenshot", { format: "png" }, 7000);
    return fallback?.data || "";
  }

  public async printToPDF(tabId: number, options?: Record<string, any>): Promise<string> {
    try {
      await this.sendCommand(tabId, "Page.enable");
    } catch {}
    // Long pages take well over the default 5 s to print
    const result = await this.sendCommand(
      tabId,
      "Page.printToPDF",
      options || { printBackground: true, preferCSSPageSize: true },
      60000
    );
    return result?.data || "";
  }

  public async evaluate(tabId: number, expression: string): Promise<any> {
    const result = await this.sendCommand(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "CDP evaluation exception";
      // The code ran and threw in the page; callers must not run it again another way
      throw Object.assign(new Error(desc), { thrownByPage: true });
    }
    return result?.result?.value;
  }

  private waitForEvent(tabId: number, method: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const listener = (source: chrome.debugger.Debuggee, eventMethod: string, params?: object) => {
        if (source.tabId !== tabId || eventMethod !== method) return;
        done();
        resolve(params);
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`${method} did not fire within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(listener);
      };
      chrome.debugger.onEvent.addListener(listener);
    });
  }

  private async setFiles(tabId: number, node: { objectId?: string; backendNodeId?: number }, files: string[]): Promise<void> {
    try {
      await this.sendCommand(tabId, "DOM.setFileInputFiles", { ...node, files });
    } catch (err: any) {
      // Chrome only lets an extension's debugger hand local files to a page when it may read file:// URLs
      if (/not allowed/i.test(err?.message || "") && !(await chrome.extension.isAllowedFileSchemeAccess())) {
        throw new Error(
          'Chrome refused to attach local files: open chrome://extensions, click Details on OpenCode Chrome Relay and turn on "Allow access to file URLs"'
        );
      }
      throw err;
    }
  }

  // Puts local files into a page's file input. The locator may name the input itself, an element that
  // contains or labels one, or a button that opens the file chooser; with no locator the page's first
  // file input (or upload button) is used.
  public async uploadFiles(
    tabId: number,
    locator: { selector?: string; name?: string; text?: string } | undefined,
    files: string[]
  ): Promise<{ via: string; fileNames: string[] }> {
    const selector = locator?.selector || null;
    const name = locator?.name || locator?.text || null;
    const found = await this.sendCommand(tabId, "Runtime.evaluate", {
      expression: `(${findUploadTarget.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(name)})`,
      returnByValue: false,
    });
    if (found?.exceptionDetails) {
      throw new Error(found.exceptionDetails.exception?.description || found.exceptionDetails.text || "Upload target lookup failed");
    }
    const objectId: string | undefined = found?.result?.objectId;
    if (!objectId) {
      throw new Error(
        selector || name
          ? `No upload target matches ${selector ? `selector ${selector}` : `"${name}"`}`
          : "No <input type=file> or upload button on this page; pass the selector or label of the upload control"
      );
    }

    const callOn = async (id: string, fn: string, userGesture = false) =>
      (await this.sendCommand(tabId, "Runtime.callFunctionOn", {
        objectId: id,
        functionDeclaration: fn,
        returnByValue: true,
        userGesture,
      }))?.result?.value;

    const isFileInput = await callOn(objectId, "function () { return this instanceof HTMLInputElement && this.type === 'file'; }");
    let inputObjectId = objectId;
    let via = "file input";
    if (isFileInput) {
      await this.setFiles(tabId, { objectId }, files);
    } else {
      via = "file chooser";
      await this.sendCommand(tabId, "Page.enable");
      await this.sendCommand(tabId, "Page.setInterceptFileChooserDialog", { enabled: true });
      try {
        const opened = this.waitForEvent(tabId, "Page.fileChooserOpened", 8000);
        await callOn(objectId, "function () { this.scrollIntoView({ block: 'center' }); this.click(); }", true);
        const chooser = await opened.catch(() => {
          throw new Error("Clicking the upload control did not open a file chooser; pass the selector of the file input instead");
        });
        if (!chooser?.backendNodeId) throw new Error("The file chooser did not report its input element");
        await this.setFiles(tabId, { backendNodeId: chooser.backendNodeId }, files);
        const resolved = await this.sendCommand(tabId, "DOM.resolveNode", { backendNodeId: chooser.backendNodeId });
        inputObjectId = resolved?.object?.objectId || objectId;
      } finally {
        await this.sendCommand(tabId, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
      }
    }

    const fileNames: string[] =
      (await callOn(inputObjectId, "function () { return Array.from(this.files || []).map((f) => f.name); }")) || [];
    return { via, fileNames };
  }
}

// Runs in the page. Searches open shadow roots too, since upload widgets often live in them.
function findUploadTarget(selector: string | null, name: string | null): Element | null {
  const deepAll = (root: ParentNode, sel: string): Element[] => {
    const out = Array.from(root.querySelectorAll(sel));
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) out.push(...deepAll(el.shadowRoot, sel));
    }
    return out;
  };
  const isFileInput = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "file";
  const fileInputFor = (el: Element): HTMLInputElement | null => {
    if (isFileInput(el)) return el;
    if (el instanceof HTMLLabelElement && isFileInput(el.control)) return el.control;
    const inside = deepAll(el, 'input[type="file"]')[0] || (el.shadowRoot && deepAll(el.shadowRoot, 'input[type="file"]')[0]);
    return (inside as HTMLInputElement) || null;
  };
  const byLabel = (pattern: (label: string) => boolean): Element | null => {
    const matches = deepAll(document, 'input[type="file"], button, label, a, [role="button"]').filter((el) => {
      const label = [(el as HTMLElement).innerText, el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("name")]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return label && pattern(label);
    });
    // The tightest match is the control itself rather than a wrapper around it
    matches.sort((a, b) => ((a as HTMLElement).innerText || "").length - ((b as HTMLElement).innerText || "").length);
    return matches[0] || null;
  };

  let target: Element | null = null;
  if (selector) {
    try {
      target = deepAll(document, selector)[0] || null;
    } catch {
      throw new Error(`Invalid CSS selector: ${selector}`);
    }
  } else if (name) {
    const want = name.trim().toLowerCase();
    target = byLabel((label) => label.includes(want));
  } else {
    target =
      deepAll(document, 'input[type="file"]')[0] ||
      byLabel((label) => /\b(upload|choose files?|select files?|browse|attach|add files?)\b/.test(label));
  }
  return target ? fileInputFor(target) || target : null;
}
