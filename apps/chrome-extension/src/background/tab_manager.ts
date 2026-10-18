export interface AttachOptions {
  autoDetachMs?: number;
}

export class TabManager {
  private attachedTabs: Set<number> = new Set();
  private activeTabId: number | null = null;
  private autoDetach: Map<number, { delayMs: number; timer: ReturnType<typeof setTimeout> }> = new Map();
  private stickyTabs: Set<number> = new Set();
  private isBusy: () => boolean = () => false;

  constructor() {
    if (typeof chrome !== "undefined" && chrome.debugger?.onDetach) {
      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId) {
          this.clearAutoDetach(source.tabId);
          this.stickyTabs.delete(source.tabId);
          this.attachedTabs.delete(source.tabId);
          if (this.activeTabId === source.tabId) {
            this.activeTabId = null;
          }
        }
      });
    }
  }

  public setBusyCheck(check: () => boolean): void {
    this.isBusy = check;
  }

  public async attachTab(tabId: number, options: AttachOptions = {}): Promise<boolean> {
    try {
      if (this.attachedTabs.has(tabId)) {
        this.activeTabId = tabId;
        this.updateAutoDetach(tabId, options);
        return true;
      }
      await chrome.debugger.attach({ tabId }, "1.3");
      this.attachedTabs.add(tabId);
      this.activeTabId = tabId;
      await this.configureTabDebugger(tabId);
      this.updateAutoDetach(tabId, options);
      return true;
    } catch (err: any) {
      if (err?.message?.includes("already attached")) {
        this.attachedTabs.add(tabId);
        this.activeTabId = tabId;
        await this.configureTabDebugger(tabId);
        this.updateAutoDetach(tabId, options);
        return true;
      }
      return false;
    }
  }

  public refreshAutoDetach(): void {
    for (const [tabId, entry] of this.autoDetach) {
      this.scheduleAutoDetach(tabId, entry.delayMs);
    }
  }

  private updateAutoDetach(tabId: number, options: AttachOptions): void {
    if (!options.autoDetachMs) {
      this.clearAutoDetach(tabId);
      this.stickyTabs.add(tabId);
      return;
    }
    if (!this.stickyTabs.has(tabId)) {
      this.scheduleAutoDetach(tabId, options.autoDetachMs);
    }
  }

  private scheduleAutoDetach(tabId: number, delayMs: number): void {
    const existing = this.autoDetach.get(tabId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      if (this.isBusy()) {
        this.scheduleAutoDetach(tabId, delayMs);
        return;
      }
      this.autoDetach.delete(tabId);
      void this.detachTab(tabId);
    }, delayMs);
    this.autoDetach.set(tabId, { delayMs, timer });
  }

  private clearAutoDetach(tabId: number): void {
    const existing = this.autoDetach.get(tabId);
    if (existing) clearTimeout(existing.timer);
    this.autoDetach.delete(tabId);
  }

  private async configureTabDebugger(tabId: number): Promise<void> {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    } catch {}
    try {
      await chrome.debugger.sendCommand({ tabId }, "Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: "",
        eventsEnabled: true,
      });
    } catch {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: "",
        });
      } catch {}
    }
  }

  public async detachTab(tabId: number): Promise<boolean> {
    try {
      if (!this.attachedTabs.has(tabId)) {
        return true;
      }
      this.clearAutoDetach(tabId);
      this.stickyTabs.delete(tabId);
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
    this.clearAutoDetach(tabId);
    this.stickyTabs.delete(tabId);
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
