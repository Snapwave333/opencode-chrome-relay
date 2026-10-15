import { describe, it, expect } from "vitest";
import {
  NvidiaNimClient,
  NVIDIA_NIM_FREE_MODELS,
} from "../../packages/opencode-plugin/src/index.js";

describe("NVIDIA NIM Free Models, Retries & Cooldowns", () => {
  it("defines free NVIDIA NIM models for text and vision", () => {
    expect(NVIDIA_NIM_FREE_MODELS.generalText).toBe("meta/llama-3.3-70b-instruct");
    expect(NVIDIA_NIM_FREE_MODELS.fastText).toBe("meta/llama-3.1-8b-instruct");
    expect(NVIDIA_NIM_FREE_MODELS.reasoning).toBe("nvidia/nemotron-4-340b-instruct");
    expect(NVIDIA_NIM_FREE_MODELS.vision).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(NVIDIA_NIM_FREE_MODELS.fallbackVision).toBe("nvidia/neva-22b");
  });

  it("completes query using default free NVIDIA NIM model", async () => {
    const nim = new NvidiaNimClient("nvapi-free-tier-mock");
    const res = await nim.complete([
      { role: "user", content: "Analyze browser layout" },
    ]);

    expect(res.modelUsed).toBe(NVIDIA_NIM_FREE_MODELS.generalText);
    expect(res.text).toContain("NVIDIA NIM");
    expect(res.retries).toBe(0);
  });

  it("handles model cooldown and routes to fallback free model when in cooldown", async () => {
    const nim = new NvidiaNimClient("nvapi-free-tier-mock");

    // Put flagship model in cooldown (e.g. simulated after 429)
    nim.setModelCooldown(NVIDIA_NIM_FREE_MODELS.generalText, 5000);
    expect(nim.getModelCooldownRemaining(NVIDIA_NIM_FREE_MODELS.generalText)).toBeGreaterThan(0);

    // Completion should automatically route to fast free fallback model
    const res = await nim.complete([
      { role: "user", content: "Quick check" },
    ]);

    expect(res.modelUsed).toBe(NVIDIA_NIM_FREE_MODELS.fastText);

    // Clear cooldown
    nim.clearCooldown(NVIDIA_NIM_FREE_MODELS.generalText);
    expect(nim.getModelCooldownRemaining(NVIDIA_NIM_FREE_MODELS.generalText)).toBe(0);

    const normalRes = await nim.complete([
      { role: "user", content: "Back to flagship" },
    ]);
    expect(normalRes.modelUsed).toBe(NVIDIA_NIM_FREE_MODELS.generalText);
  });

  it("handles vision model cooldown and falls back to secondary vision model", async () => {
    const nim = new NvidiaNimClient("nvapi-free-tier-mock");

    // Put primary vision model in cooldown
    nim.setModelCooldown(NVIDIA_NIM_FREE_MODELS.vision, 5000);

    const res = await nim.complete(
      [{ role: "user", content: "Inspect screenshot" }],
      { model: NVIDIA_NIM_FREE_MODELS.vision }
    );

    expect(res.modelUsed).toBe(NVIDIA_NIM_FREE_MODELS.fallbackVision);
  });
});

describe("Multi-Session Tabbed Management & Close Deletion Logic", () => {
  interface MockSession {
    runId: string;
    name: string;
    isPinned: boolean;
  }

  class MockSessionManager {
    public sessions: Map<string, MockSession> = new Map();
    public activeId: string = "";

    public create(runId: string, name: string): MockSession {
      const s = { runId, name, isPinned: false };
      this.sessions.set(runId, s);
      this.activeId = runId;
      return s;
    }

    public pin(runId: string, isPinned: boolean): void {
      const s = this.sessions.get(runId);
      if (s) s.isPinned = isPinned;
    }

    public close(runId: string): { deleted: boolean; reason?: string } {
      const s = this.sessions.get(runId);
      if (!s) return { deleted: true };
      if (s.isPinned) {
        return { deleted: false, reason: "Session is pinned; preserved on close" };
      }
      this.sessions.delete(runId);
      return { deleted: true };
    }

    public deleteManual(runId: string): void {
      this.sessions.delete(runId);
    }
  }

  it("deletes unpinned session on close, but preserves pinned sessions", () => {
    const mgr = new MockSessionManager();

    // Session 1: unpinned
    mgr.create("s1", "Temporary Task");
    expect(mgr.sessions.size).toBe(1);

    // Closing unpinned session -> deleted immediately
    const closeRes1 = mgr.close("s1");
    expect(closeRes1.deleted).toBe(true);
    expect(mgr.sessions.has("s1")).toBe(false);

    // Session 2: pinned
    mgr.create("s2", "Persistent Task");
    mgr.pin("s2", true);

    // Closing pinned session -> NOT deleted
    const closeRes2 = mgr.close("s2");
    expect(closeRes2.deleted).toBe(false);
    expect(closeRes2.reason).toContain("pinned");
    expect(mgr.sessions.has("s2")).toBe(true);

    // Manual delete -> deletes even if pinned
    mgr.deleteManual("s2");
    expect(mgr.sessions.has("s2")).toBe(false);
  });

  it("supports multiple concurrent tabbed sessions", () => {
    const mgr = new MockSessionManager();
    mgr.create("tab_1", "Scrape Products");
    mgr.create("tab_2", "Fill Survey");
    mgr.create("tab_3", "Research Docs");

    expect(mgr.sessions.size).toBe(3);
    expect(mgr.activeId).toBe("tab_3");

    // Pin tab 2
    mgr.pin("tab_2", true);

    // Close tab 1 (unpinned) -> deleted
    expect(mgr.close("tab_1").deleted).toBe(true);
    expect(mgr.sessions.size).toBe(2);

    // Close tab 2 (pinned) -> preserved
    expect(mgr.close("tab_2").deleted).toBe(false);
    expect(mgr.sessions.size).toBe(2);
  });
});
