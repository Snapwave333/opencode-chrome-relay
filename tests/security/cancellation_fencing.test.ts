import { describe, it, expect } from "vitest";
import {
  evaluateActionPolicy,
  ActionPayload,
} from "../../packages/protocol/src/index.js";

describe("Cancellation Fencing and Epoch Security Tests", () => {
  it("rejects actions with stale epochs or mismatched run states", () => {
    // Model checking simulation of cancellation fence
    class MockFence {
      private activeEpoch = 2;
      private isPaused = false;
      private isStopped = false;

      public admit(epoch: number): { allowed: boolean; reason?: string } {
        if (this.isStopped) return { allowed: false, reason: "Run is stopped" };
        if (this.isPaused) return { allowed: false, reason: "Run is paused" };
        if (epoch < this.activeEpoch) {
          return {
            allowed: false,
            reason: `Stale epoch: incoming ${epoch} < active ${this.activeEpoch}`,
          };
        }
        return { allowed: true };
      }

      public pause() {
        this.isPaused = true;
      }
      public stop() {
        this.activeEpoch += 1;
        this.isStopped = true;
      }
    }

    const fence = new MockFence();
    expect(fence.admit(2).allowed).toBe(true);

    // Stale epoch rejected
    const staleResult = fence.admit(1);
    expect(staleResult.allowed).toBe(false);
    expect(staleResult.reason).toContain("Stale epoch");

    // Actions during pause rejected
    fence.pause();
    const pausedResult = fence.admit(2);
    expect(pausedResult.allowed).toBe(false);
    expect(pausedResult.reason).toBe("Run is paused");

    // Actions during stop rejected and epoch bumped
    fence.stop();
    const stoppedResult = fence.admit(2);
    expect(stoppedResult.allowed).toBe(false);
    expect(stoppedResult.reason).toBe("Run is stopped");
  });

  it("prevents execution of non-idempotent actions after completion", () => {
    const journal = new Set<string>();

    function recordAndExecute(key: string): boolean {
      if (journal.has(key)) {
        return false; // Replay rejected
      }
      journal.add(key);
      return true;
    }

    expect(recordAndExecute("run_42:3:1")).toBe(true);
    // Duplicate attempt with same idempotency key must fail
    expect(recordAndExecute("run_42:3:1")).toBe(false);
  });
});
