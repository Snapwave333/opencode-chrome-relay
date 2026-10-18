import { describe, it, expect } from "vitest";
import { isNativeDialogActive, dismissNativeSaveDialog } from "../../packages/opencode-plugin/src/native_dialog.js";

describe("Native Dialog Automation", () => {
  it("checks whether a native Save As / Download dialog is active without throwing", () => {
    const active = isNativeDialogActive();
    expect(typeof active).toBe("boolean");
  });

  it("handles dismissNativeSaveDialog invocation safely and returns structured result", () => {
    const res = dismissNativeSaveDialog({ action: "save", timeoutMs: 1500 });
    expect(res).toBeDefined();
    expect(typeof res.dismissed).toBe("boolean");
    expect(typeof res.dialogFound).toBe("boolean");
    expect(["saved", "cancelled", "none"]).toContain(res.actionTaken);
  });
});
