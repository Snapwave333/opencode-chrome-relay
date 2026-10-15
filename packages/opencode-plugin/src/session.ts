export interface SessionBinding {
  serverId?: string;
  projectId?: string;
  sessionId: string;
  runId: string;
  tabId?: number;
  originScope?: string[];
  model?: string;
  provider?: string;
  visionModel?: string; // Configured vision-capable model
}

export class SessionContextManager {
  private activeBinding: SessionBinding | null = null;
  private defaultVisionModel = "gpt-4o";

  public bindSession(binding: SessionBinding): void {
    this.activeBinding = { ...binding };
  }

  public getActiveBinding(): SessionBinding | null {
    return this.activeBinding ? { ...this.activeBinding } : null;
  }

  public setVisionModel(modelName: string): void {
    if (this.activeBinding) {
      this.activeBinding.visionModel = modelName;
    } else {
      this.defaultVisionModel = modelName;
    }
  }

  public getVisionModel(): string {
    if (this.activeBinding?.visionModel) {
      return this.activeBinding.visionModel;
    }
    const current = this.activeBinding?.model || "";
    // If the active model is already a known vision-capable model, reuse it
    if (/vision|gpt-4o|claude-3|gemini/i.test(current)) {
      return current;
    }
    return this.defaultVisionModel;
  }

  public clearBinding(): void {
    this.activeBinding = null;
  }
}
