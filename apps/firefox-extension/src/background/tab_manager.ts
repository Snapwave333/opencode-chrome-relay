export class TabManager {
  private attachedTabs: Set<number> = new Set();
  private activeTabId: number | null = null;

  constructor() {
    if (typeof chrome !== "undefined" && chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId) {
          this.attachedTabs.delete(source.tabId);
          if (this.activeTabId === source.tabId) {
            this.activeTabId = null;
          }
        }
      });
    }
  }

  public async attachTab(tabId: number): Promise<boolean> {
    try {
      if (this.attachedTabs.has(tabId)) {
        this.activeTabId = tabId;
        return true;
      }
      await chrome.debugger.attach({ tabId }, "1.3");
      this.attachedTabs.add(tabId);
      this.activeTabId = tabId;
      await this.configureTabDebugger(tabId);
      return true;
    } catch (err: any) {
      // Chrome says "already attached" both when this extension still holds the tab (e.g. after a
      // service-worker restart) and when DevTools or another extension does; only the first is usable
      const ownedByUs =
        err?.message?.includes("already attached") &&
        (await chrome.debugger.getTargets()).some(
          (t) => t.tabId === tabId && t.attached && t.extensionId === chrome.runtime.id
        );
      if (ownedByUs) {
        this.attachedTabs.add(tabId);
        this.activeTabId = tabId;
        await this.configureTabDebugger(tabId);
        return true;
      }
      return false;
    }
  }

  // Download behavior is deliberately left alone: Browser.setDownloadBehavior is browser-wide, and
  // "allow" with an empty downloadPath left every download in Chrome stuck at 100% with no file
  private async configureTabDebugger(tabId: number): Promise<void> {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    } catch {}
  }

  public async detachTab(tabId: number): Promise<boolean> {
    try {
      if (!this.attachedTabs.has(tabId)) {
        return true;
      }
      await chrome.debugger.detach({ tabId });
      this.attachedTabs.delete(tabId);
      if (this.activeTabId === tabId) {
        this.activeTabId = null;
      }
      return true;
    } catch {
      this.attachedTabs.delete(tabId);
      return false;
    }
  }

  public markDetached(tabId: number): void {
    this.attachedTabs.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
    }
  }

  public isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  public getActiveTabId(): number | null {
    return this.activeTabId;
  }
}
