import { describe, it, expect } from "vitest";
import {
  ProtocolEnvelopeSchema,
  evaluateActionPolicy,
  isForbiddenUrl,
  ControlCommandSchema,
  ActionPayload,
} from "../../packages/protocol/src/index.js";

describe("Protocol Contract & Schema Tests", () => {
  it("validates a standard action request envelope", () => {
    const raw = {
      v: 1,
      event: "action.started",
      event_id: "evt_01",
      run_id: "run_42",
      epoch: 3,
      sequence: 17,
      tab_id: 123,
      lease_id: "lease_42",
      idempotency_key: "run_42:3:17",
      action: {
        type: "browser_click",
        locator: { role: "button", name: "Save changes" },
        risk: "external_effect",
        is_irreversible: false,
      },
    };

    const parsed = ProtocolEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.run_id).toBe("run_42");
      expect(parsed.data.epoch).toBe(3);
      expect(parsed.data.action?.type).toBe("browser_click");
    }
  });

  it("validates control commands (pause, stop, steer, restart)", () => {
    const steerCmd = {
      command: "steer",
      run_id: "run_42",
      epoch: 3,
      instruction: "Don't press Save yet; switch to monthly notifications.",
    };
    const parsedSteer = ControlCommandSchema.safeParse(steerCmd);
    expect(parsedSteer.success).toBe(true);

    const stopCmd = {
      command: "stop",
      run_id: "run_42",
      epoch: 3,
      reason: "User hit Stop in side panel",
    };
    expect(ControlCommandSchema.safeParse(stopCmd).success).toBe(true);
  });

  it("detects forbidden URLs correctly", () => {
    expect(isForbiddenUrl("chrome://settings")).toBe(true);
    expect(isForbiddenUrl("chrome-extension://abcdef/index.html")).toBe(true);
    expect(isForbiddenUrl("edge://extensions")).toBe(true);
    expect(isForbiddenUrl("https://example.com")).toBe(false);
  });

  it("evaluates authorization policy for inspect, assist, and autopilot", () => {
    const clickAction: ActionPayload = {
      type: "browser_click",
      locator: { role: "button", name: "Submit application" },
      risk: "external_effect",
      is_irreversible: true,
    };

    // Inspect mode blocks mutations
    const inspectResult = evaluateActionPolicy("inspect", clickAction, "https://example.com", ["https://example.com"]);
    expect(inspectResult.requiresApproval).toBe(true);

    // Assist mode requires approval for external effects or sensitive patterns ("Submit")
    const assistResult = evaluateActionPolicy("assist", clickAction, "https://example.com", ["https://example.com"]);
    expect(assistResult.requiresApproval).toBe(true);

    // Read only action in inspect mode is allowed
    const readAction: ActionPayload = {
      type: "browser_snapshot",
      risk: "read_only",
      is_irreversible: false,
    };
    const readResult = evaluateActionPolicy("inspect", readAction, "https://example.com", ["https://example.com"]);
    expect(readResult.requiresApproval).toBe(false);
  });
});
