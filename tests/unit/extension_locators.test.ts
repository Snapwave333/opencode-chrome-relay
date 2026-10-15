import { describe, it, expect } from "vitest";
import { resolveElementLocator } from "../../apps/chrome-extension/src/browser/locators.js";

describe("Extension Semantic Locators", () => {
  it("resolves coordinate point directly", () => {
    const mockDoc = {
      elementFromPoint: () => null,
    } as unknown as Document;

    const res = resolveElementLocator({ point: { x: 150, y: 250 } }, mockDoc);
    expect(res.found).toBe(true);
    expect(res.matchedBy).toBe("point");
    expect(res.box?.centerX).toBe(150);
    expect(res.box?.centerY).toBe(250);
  });

  it("resolves by testId if element exists", () => {
    const mockElement = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    };
    const mockDoc = {
      querySelector: (sel: string) => {
        if (sel === '[data-testid="submit-btn"]') return mockElement;
        return null;
      },
    } as unknown as Document;

    const res = resolveElementLocator({ testId: "submit-btn" }, mockDoc);
    expect(res.found).toBe(true);
    expect(res.matchedBy).toBe("testId");
    expect(res.box?.centerX).toBe(60);
    expect(res.box?.centerY).toBe(40);
  });

  it("resolves by role and accessible name", () => {
    const mockButton = {
      tagName: "BUTTON",
      getAttribute: (attr: string) => (attr === "role" ? "button" : null),
      textContent: "Save preferences",
      getBoundingClientRect: () => ({ left: 50, top: 100, width: 120, height: 30 }),
    };

    const mockDoc = {
      querySelector: () => null,
      querySelectorAll: () => [mockButton],
    } as unknown as Document;

    const res = resolveElementLocator({ role: "button", name: "Save preferences" }, mockDoc);
    expect(res.found).toBe(true);
    expect(res.matchedBy).toBe("role_and_name");
    expect(res.box?.centerX).toBe(110);
    expect(res.box?.centerY).toBe(115);
  });

  it("returns found=false if no matching element", () => {
    const mockDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as Document;

    const res = resolveElementLocator({ role: "button", name: "NonExistent" }, mockDoc);
    expect(res.found).toBe(false);
    expect(res.matchedBy).toBe("none");
  });
});
