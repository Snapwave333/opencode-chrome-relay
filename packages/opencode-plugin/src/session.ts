export interface SessionBinding {
  serverId?: string;
  projectId?: string;
  sessionId: string;
  runId: string;
  tabId?: number;
  originScope?: string[];
  model?: string;
  provider?: string;
}

export class SessionContextManager {
  private activeBinding: SessionBinding | null = null;

  public bindSession(binding: SessionBinding): void {
    this.activeBinding = { ...binding };
  }

  public getActiveBinding(): SessionBinding | null {
    return this.activeBinding ? { ...this.activeBinding } : null;
  }

  public clearBinding(): void {
    this.activeBinding = null;
  }
}
