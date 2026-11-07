import { describe, it, expect } from "vitest";
import { isNativeDialogActive } from "../../packages/opencode-plugin/src/native_dialog.js";

// dismissNativeSaveDialog presses a real button on the real desktop, so the suite never calls it
describe("Native Dialog Automation", () => {
  it("checks whether Chrome's Save As dialog is open without touching it", () => {
    const active = isNativeDialogActive();
    expect(typeof active).toBe("boolean");
  }, 20000);
});
