export { NVIDIA_NIM_FREE_MODELS } from "@opencode/chrome-relay-protocol";
import { NVIDIA_NIM_FREE_MODELS } from "@opencode/chrome-relay-protocol";

export interface NimMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

export interface NimCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class NvidiaNimClient {
  private apiKey: string;
  private baseUrl: string;
  private cooldowns: Map<string, number> = new Map(); // model -> cooldown timestamp (ms)

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.NVIDIA_API_KEY || "nvapi-free-tier-mock";
    this.baseUrl = baseUrl || process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
  }

  public getModelCooldownRemaining(model: string): number {
    const expiresAt = this.cooldowns.get(model);
    if (!expiresAt) return 0;
    const remaining = expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  public setModelCooldown(model: string, cooldownDurationMs: number): void {
    this.cooldowns.set(model, Date.now() + cooldownDurationMs);
  }

  public clearCooldown(model: string): void {
    this.cooldowns.delete(model);
  }

  public async complete(
    messages: NimMessage[],
    options: NimCompletionOptions = {}
  ): Promise<{ text: string; modelUsed: string; retries: number }> {
    const requestedModel = options.model || NVIDIA_NIM_FREE_MODELS.generalText;
    const maxRetries = options.maxRetries ?? 3;
    const baseDelay = options.baseDelayMs ?? 1000;

    let modelToUse = requestedModel;
    let retries = 0;

    // Check if requested model is in cooldown; if so, attempt fallback free NIM model
    const cooldownRemaining = this.getModelCooldownRemaining(requestedModel);
    if (cooldownRemaining > 0) {
      if (requestedModel === NVIDIA_NIM_FREE_MODELS.generalText) {
        modelToUse = NVIDIA_NIM_FREE_MODELS.fastText;
      } else if (requestedModel === NVIDIA_NIM_FREE_MODELS.vision) {
        modelToUse = NVIDIA_NIM_FREE_MODELS.fallbackVision;
      }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.sendRequest(modelToUse, messages, options);
        return {
          text: res,
          modelUsed: modelToUse,
          retries,
        };
      } catch (err: any) {
        const isRateLimit = err.status === 429 || (err.message && /rate limit|too many requests|429/i.test(err.message));
        const isGoneOrNotFound = err.status === 410 || err.status === 404;
        const isServerError = err.status >= 500 && err.status < 600;

        if ((isRateLimit || isGoneOrNotFound || isServerError) && attempt < maxRetries) {
          retries++;
          const cooldownTime = isRateLimit ? Math.max(3000, 2000 * Math.pow(2, attempt)) : 1000;
          this.setModelCooldown(modelToUse, cooldownTime);

          if (isGoneOrNotFound) {
            modelToUse = "poolside/laguna-xs-2.1";
          } else if (isRateLimit && modelToUse === NVIDIA_NIM_FREE_MODELS.generalText) {
            modelToUse = NVIDIA_NIM_FREE_MODELS.fastText;
          } else if (isRateLimit && modelToUse === NVIDIA_NIM_FREE_MODELS.vision) {
            modelToUse = NVIDIA_NIM_FREE_MODELS.fallbackVision;
          }

          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw new Error(`Exceeded max retries (${maxRetries}) for NVIDIA NIM model ${modelToUse}`);
  }

  private async sendRequest(
    model: string,
    messages: NimMessage[],
    options: NimCompletionOptions
  ): Promise<string> {
    // If running in test or offline mock environment
    if (process.env.NODE_ENV === "test" || this.apiKey.startsWith("nvapi-free-tier-mock")) {
      return `[NVIDIA NIM ${model}] Generated response for ${messages.length} messages.`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.max_tokens ?? 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`NVIDIA NIM API Error (${response.status}): ${errorText}`);
      (error as any).status = response.status;
      throw error;
    }

    const data: any = await response.json();
    const msg = data?.choices?.[0]?.message;
    return msg?.content || msg?.reasoning_content || "";
  }
}
