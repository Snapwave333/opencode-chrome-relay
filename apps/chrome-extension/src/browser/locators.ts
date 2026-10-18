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

  // Check active dialogs first
  const activeDialogs =
    typeof rootDocument.querySelectorAll === "function"
      ? Array.from(
          rootDocument.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], .modal.show, .modal:not([style*="display: none"]), [data-modal="true"], [data-state="open"], [data-radix-portal], [class*="download-modal" i], [class*="download-dialog" i]'
          )
        )
      : [];

  // 2. Index locator: [data-relay-index="..."] or locator.index
  const indexMatch = locator.selector?.match(/^\[data-relay-index="(\d+)"\]$/);
  const targetIndex = indexMatch
    ? parseInt(indexMatch[1], 10)
    : typeof (locator as any).index === "number"
    ? (locator as any).index
    : null;

  if (targetIndex !== null) {
    for (const d of activeDialogs) {
      const el = d.querySelector?.(`[data-relay-index="${targetIndex}"]`);
      if (el) return buildResolvedTarget(el, "selector");
    }
    const stamped = rootDocument.querySelector?.(`[data-relay-index="${targetIndex}"]`);
    if (stamped) return buildResolvedTarget(stamped, "selector");
  }

  // 3. Test ID
  if (locator.testId) {
    const testIdSelector = `[data-testid="${locator.testId.replace(/["\\]/g, "\\$&")}"]`;
    for (const d of activeDialogs) {
      const el = d.querySelector?.(testIdSelector);
      if (el) return buildResolvedTarget(el, "testId");
    }
    const el = rootDocument.querySelector?.(testIdSelector);
    if (el) return buildResolvedTarget(el, "testId");
  }

  // 4. CSS Selector
  if (locator.selector && targetIndex === null) {
    try {
      for (const d of activeDialogs) {
        const el = d.querySelector?.(locator.selector);
        if (el) return buildResolvedTarget(el, "selector");
      }
      const el = rootDocument.querySelector?.(locator.selector);
      if (el) return buildResolvedTarget(el, "selector");
    } catch {
      // Invalid selector fallback
    }
  }

  // 5. Role + Accessible Name (guard: don't use digit string as fuzzy query)
  const isNumericOnly = locator.name && /^\d+$/.test(locator.name.trim());
  if (locator.role || (locator.name && !isNumericOnly)) {
    const searchScopes = activeDialogs.length > 0 ? [...activeDialogs, rootDocument] : [rootDocument];
    for (const scope of searchScopes) {
      const elements: Element[] = [];
      if (typeof scope.querySelectorAll === "function") {
        elements.push(...Array.from(scope.querySelectorAll("button, a, input, select, textarea, [role], [aria-label]")));
      }
      if (typeof (scope as any).getAttribute === "function" && typeof (scope as any).tagName === "string") {
        elements.push(scope as Element);
      }
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
  }

  // 6. Text search
  if (locator.text) {
    const searchScopes = activeDialogs.length > 0 ? [...activeDialogs, rootDocument] : [rootDocument];
    const targetText = locator.text.toLowerCase();
    for (const scope of searchScopes) {
      if (typeof scope.querySelectorAll === "function") {
        const all = Array.from(scope.querySelectorAll("*"));
        for (const el of all) {
          if (
            (!el.children || el.children.length === 0) &&
            (el.textContent || "").toLowerCase().includes(targetText)
          ) {
            return buildResolvedTarget(el, "text");
          }
        }
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
