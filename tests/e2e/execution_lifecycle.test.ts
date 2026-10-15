import { describe, it, expect } from "vitest";
import {
  ExecutionState,
  ControlType,
  ControlCommand,
} from "../../packages/protocol/src/index.js";

// Simulating full execution lifecycle controller
class ExecutionLifecycleController {
  public state: ExecutionState = "READY";
  public epoch = 0;
  public sequence = 0;
  public pendingInstruction?: string;

  public applyControl(cmd: ControlCommand): ExecutionState {
    switch (cmd.command) {
      case "pause":
        if (this.state === "RUNNING") {
          this.state = "PAUSED";
        }
        break;
      case "resume":
        if (this.state === "PAUSED") {
          this.state = "RUNNING";
        }
        break;
      case "stop":
        this.epoch += 1;
        this.state = "STOPPED";
        break;
      case "restart":
        this.epoch += 1;
        this.sequence = 0;
        this.state = "RUNNING";
        break;
      case "steer":
        this.pendingInstruction = cmd.instruction;
        this.state = "RUNNING";
        break;
      case "take_over":
        this.state = "MANUAL_TAKEOVER";
        break;
      case "return_control":
        this.state = "READY";
        break;
    }
    return this.state;
  }

  public submitAction(epoch: number): { accepted: boolean; error?: string } {
    if (epoch !== this.epoch) {
      return { accepted: false, error: "Stale epoch" };
    }
    if (this.state !== "RUNNING" && this.state !== "READY") {
      return { accepted: false, error: `Invalid state: ${this.state}` };
    }
    this.sequence += 1;
    return { accepted: true };
  }
}

describe("End-to-End Execution Lifecycle & Control Semantics", () => {
  it("executes the full pause, resume, stop, restart, steer, and takeover flow", () => {
    const controller = new ExecutionLifecycleController();
    expect(controller.state).toBe("READY");

    // Start run
    controller.state = "RUNNING";
    expect(controller.submitAction(0).accepted).toBe(true);

    // 1. Pause
    controller.applyControl({ command: "pause", run_id: "run_1", epoch: 0 });
    expect(controller.state).toBe("PAUSED");
    // Action during pause fails
    expect(controller.submitAction(0).accepted).toBe(false);

    // 2. Resume
    controller.applyControl({ command: "resume", run_id: "run_1", epoch: 0 });
    expect(controller.state).toBe("RUNNING");
    expect(controller.submitAction(0).accepted).toBe(true);

    // 3. Steer
    controller.applyControl({
      command: "steer",
      run_id: "run_1",
      epoch: 0,
      instruction: "Do not click submit yet; inspect terms and conditions first.",
    });
    expect(controller.state).toBe("RUNNING");
    expect(controller.pendingInstruction).toContain("Do not click submit yet");

    // 4. Stop
    controller.applyControl({ command: "stop", run_id: "run_1", epoch: 0 });
    expect(controller.state).toBe("STOPPED");
    expect(controller.epoch).toBe(1);
    // Late action carrying stale epoch 0 fails
    expect(controller.submitAction(0).accepted).toBe(false);
    expect(controller.submitAction(0).error).toBe("Stale epoch");

    // 5. Restart
    controller.applyControl({
      command: "restart",
      run_id: "run_1",
      epoch: 1,
      restart_options: { from_current_page: true, retry_safe_step: false },
    });
    expect(controller.state).toBe("RUNNING");
    expect(controller.epoch).toBe(2);
    expect(controller.sequence).toBe(0);
    // Action with new epoch 2 succeeds
    expect(controller.submitAction(2).accepted).toBe(true);

    // 6. Manual Take Over
    controller.applyControl({ command: "take_over", run_id: "run_1", epoch: 2 });
    expect(controller.state).toBe("MANUAL_TAKEOVER");
    expect(controller.submitAction(2).accepted).toBe(false);

    // 7. Return Control
    controller.applyControl({ command: "return_control", run_id: "run_1", epoch: 2 });
    expect(controller.state).toBe("READY");
  });
});
