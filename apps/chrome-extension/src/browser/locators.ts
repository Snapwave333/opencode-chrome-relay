import { ElementLocator } from "@opencode/chrome-relay-protocol";

export interface ResolvedTarget {
  found: boolean;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  matchedBy: "role_and_name" | "selector" | "text" | "point" | "testId" | "none";
  element?: Element;
}

export function resolveElementLocator(
  locator: ElementLocator,
  rootDocument: Document = document
): ResolvedTarget {
  // 1. Point fallback
  if (locator.point) {
    const el = rootDocument.elementFromPoint(locator.point.x, locator.point.y);
    return {
      found: true,
      box: {
        x: locator.point.x,
        y: locator.point.y,
        width: 1,
        height: 1,
        centerX: locator.point.x,
        centerY: locator.point.y,
      },
      matchedBy: "point",
      element: el || undefined,
    };
  }

  // 2. Test ID
  if (locator.testId) {
    const el = rootDocument.querySelector(`[data-testid="${locator.testId}"]`);
    if (el) {
      return buildResolvedTarget(el, "testId");
    }
  }

  // 3. CSS Selector
  if (locator.selector) {
    try {
      const el = rootDocument.querySelector(locator.selector);
      if (el) {
        return buildResolvedTarget(el, "selector");
      }
    } catch {
      // Invalid selector fallback
    }
  }

  // 4. Role + Accessible Name
  if (locator.role || locator.name) {
    const elements = Array.from(
      rootDocument.querySelectorAll(
        "button, a, input, select, textarea, [role], [aria-label]"
      )
    );

    for (const el of elements) {
      const elRole = (el.getAttribute("role") || el.tagName.toLowerCase()).toLowerCase();
      const elAriaLabel = el.getAttribute("aria-label") || "";
      const elText = (el.textContent || "").trim();
      const elName = elAriaLabel || elText;

      const roleMatches = !locator.role || elRole === locator.role.toLowerCase();
      const nameMatches =
        !locator.name ||
        elName.toLowerCase().includes(locator.name.toLowerCase());

      if (roleMatches && nameMatches) {
        return buildResolvedTarget(el, "role_and_name");
      }
    }
  }

  // 5. Text search
  if (locator.text) {
    const all = Array.from(rootDocument.querySelectorAll("*"));
    const targetText = locator.text.toLowerCase();
    for (const el of all) {
      if (
        el.children.length === 0 &&
        (el.textContent || "").toLowerCase().includes(targetText)
      ) {
        return buildResolvedTarget(el, "text");
      }
    }
  }

  return { found: false, matchedBy: "none" };
}

function buildResolvedTarget(
  element: Element,
  matchedBy: ResolvedTarget["matchedBy"]
): ResolvedTarget {
  const rect = element.getBoundingClientRect();
  return {
    found: true,
    box: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    },
    matchedBy,
    element,
  };
}
