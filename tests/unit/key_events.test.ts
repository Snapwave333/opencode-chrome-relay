import { describe, it, expect } from "vitest";
import { keyToCDPKeyEvent } from "../../apps/chrome-extension/src/browser/actions.js";

describe("keyToCDPKeyEvent", () => {
  it("never types a named key as its own name", () => {
    for (const name of ["Delete", "Home", "End", "PageDown", "ArrowLeft", "Escape", "F5"]) {
      expect(keyToCDPKeyEvent(name).text).toBeUndefined();
    }
  });

  it("maps shortcuts to modifier bits without text", () => {
    expect(keyToCDPKeyEvent("ctrl+a")).toMatchObject({ key: "a", code: "KeyA", modifiers: 2 });
    expect(keyToCDPKeyEvent("ctrl+a").text).toBeUndefined();
    expect(keyToCDPKeyEvent("Shift+Tab")).toMatchObject({ key: "Tab", modifiers: 8 });
  });

  it("types printable characters and Enter", () => {
    expect(keyToCDPKeyEvent("x")).toMatchObject({ key: "x", code: "KeyX", text: "x" });
    expect(keyToCDPKeyEvent("7")).toMatchObject({ code: "Digit7", text: "7" });
    expect(keyToCDPKeyEvent("Enter")).toMatchObject({ key: "Enter", windowsVirtualKeyCode: 13 });
  });
});
