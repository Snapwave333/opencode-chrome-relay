export const SENSITIVE_PATTERN =
  /pass(word|code|phrase)?|passwd|pwd|secret|token|api.?key|otp|one.?time|2fa|mfa|totp|\bpin\b|cvv|cvc|csc|security.?code|card.?number|cc.?num|ssn/i;

const SENSITIVE_AUTOCOMPLETE = /current-password|new-password|one-time-code|cc-number|cc-csc/i;

export function isSensitiveField(element: Element | null | undefined): boolean {
  if (!element) return false;
  const input = element as HTMLInputElement;
  if (input.tagName === "INPUT" && (input.type || "").toLowerCase() === "password") return true;
  const autocomplete = element.getAttribute("autocomplete") || "";
  if (SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return true;
  const hints = ["name", "id", "aria-label", "placeholder", "data-testid"]
    .map((attr) => element.getAttribute(attr) || "")
    .join(" ");
  return SENSITIVE_PATTERN.test(hints);
}

export function isSensitiveLocator(locator?: { selector?: string; name?: string; text?: string } | null): boolean {
  if (!locator) return false;
  return SENSITIVE_PATTERN.test([locator.selector, locator.name, locator.text].filter(Boolean).join(" "));
}

export function maskSecret(): string {
  return "•".repeat(8);
}
