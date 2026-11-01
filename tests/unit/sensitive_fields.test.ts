import { describe, expect, it } from "vitest";
import {
  isSensitiveField,
  isSensitiveLocator,
  maskSecret,
} from "../../apps/chrome-extension/src/shared/sensitive.js";

function fakeElement(tagName: string, attrs: Record<string, string> = {}, type?: string): Element {
  return {
    tagName,
    type,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
  } as unknown as Element;
}

describe("sensitive field detection", () => {
  it("treats password inputs as sensitive regardless of naming", () => {
    expect(isSensitiveField(fakeElement("INPUT", {}, "password"))).toBe(true);
    expect(isSensitiveField(fakeElement("INPUT", {}, "PASSWORD"))).toBe(true);
  });

  it("recognises sensitive autocomplete tokens", () => {
    for (const token of ["current-password", "new-password", "one-time-code", "cc-number", "cc-csc"]) {
      expect(isSensitiveField(fakeElement("INPUT", { autocomplete: token }, "text"))).toBe(true);
    }
  });

  it("recognises sensitive names, ids, labels and placeholders", () => {
    const cases: Array<Record<string, string>> = [
      { name: "otp_code" },
      { id: "card-number" },
      { "aria-label": "Security code" },
      { placeholder: "Enter your PIN" },
      { "data-testid": "api-key-field" },
      { name: "cvv" },
    ];
    for (const attrs of cases) {
      expect(isSensitiveField(fakeElement("INPUT", attrs, "text")), JSON.stringify(attrs)).toBe(true);
    }
  });

  it("leaves ordinary fields readable", () => {
    expect(isSensitiveField(fakeElement("INPUT", { name: "email", placeholder: "you@example.com" }, "email"))).toBe(false);
    expect(isSensitiveField(fakeElement("TEXTAREA", { "aria-label": "Message" }))).toBe(false);
    expect(isSensitiveField(fakeElement("INPUT", { name: "spinner" }, "text"))).toBe(false);
    expect(isSensitiveField(undefined)).toBe(false);
  });

  it("flags sensitive locators before the element is resolved", () => {
    expect(isSensitiveLocator({ selector: "#password" })).toBe(true);
    expect(isSensitiveLocator({ name: "One-time code" })).toBe(true);
    expect(isSensitiveLocator({ selector: "#search" })).toBe(false);
    expect(isSensitiveLocator(null)).toBe(false);
  });

  it("masks with a fixed width so the secret length is not revealed", () => {
    expect(maskSecret()).toBe("••••••••");
  });
});
