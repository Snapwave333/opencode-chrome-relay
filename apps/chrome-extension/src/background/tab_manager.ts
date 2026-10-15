export class TabManager {
  private attachedTabs: Set<number> = new Set();
  private activeTabId: number | null = null;

  public async attachTab(tabId: number): Promise<boolean> {
    try {
      if (this.attachedTabs.has(tabId)) {
        this.activeTabId = tabId;
        return true;
      }
      await chrome.debugger.attach({ tabId }, "1.3");
      this.attachedTabs.add(tabId);
      this.activeTabId = tabId;
      return true;
    } catch {
      return false;
    }
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
      return false;
    }
  }

  public isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  public getActiveTabId(): number | null {
    return this.activeTabId;
  }
}
