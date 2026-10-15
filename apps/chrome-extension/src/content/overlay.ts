import { OVERLAY_CONTAINER_ID, COLORS } from "../shared/constants.js";
import { ActionPayload } from "@opencode/chrome-relay-protocol";
import { resolveElementLocator } from "../browser/locators.js";

export class ActionOverlay {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private boxElement: HTMLDivElement | null = null;
  private captionElement: HTMLDivElement | null = null;
  private clearTimer: any = null;

  public init(): void {
    if (document.getElementById(OVERLAY_CONTAINER_ID)) {
      return;
    }

    this.container = document.createElement("div");
    this.container.id = OVERLAY_CONTAINER_ID;
    this.container.style.cssText =
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647;";

    this.shadow = this.container.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .highlight-box {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid ${COLORS.cyanPrimary};
        border-radius: 4px;
        background: rgba(0, 212, 255, 0.12);
        transition: all 0.12s ease-out;
        pointer-events: none;
      }
      .click-pulse {
        animation: pulse 0.35s ease-out;
      }
      @keyframes pulse {
        0% { transform: scale(1); opacity: 0.9; box-shadow: 0 0 0 0 rgba(0, 212, 255, 0.7); }
        100% { transform: scale(1.08); opacity: 0.2; box-shadow: 0 0 0 16px rgba(0, 212, 255, 0); }
      }
      .caption-badge {
        position: absolute;
        padding: 3px 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
        color: #ffffff;
        background: #0d1117;
        border: 1px solid ${COLORS.cyanPrimary};
        border-radius: 3px;
        white-space: nowrap;
        pointer-events: none;
        transform: translateY(-100%);
        margin-top: -4px;
      }
    `;

    this.boxElement = document.createElement("div");
    this.boxElement.className = "highlight-box";
    this.boxElement.style.display = "none";

    this.captionElement = document.createElement("div");
    this.captionElement.className = "caption-badge";
    this.captionElement.style.display = "none";

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.boxElement);
    this.shadow.appendChild(this.captionElement);
    document.documentElement.appendChild(this.container);
  }

  public showActionPreview(action: ActionPayload): void {
    if (!this.shadow) this.init();
    if (!this.boxElement || !this.captionElement) return;

    if (this.clearTimer) clearTimeout(this.clearTimer);

    let caption = "Inspecting";
    if (action.type === "browser_click") caption = "Clicking";
    else if (action.type === "browser_type") caption = "Entering text";
    else if (action.type === "browser_scroll") caption = `Scrolling ${action.scroll_direction || "down"}`;
    else if (action.type === "browser_navigate") caption = "Navigating";

    let targetBox: any = null;
    if (action.locator) {
      const res = resolveElementLocator(action.locator, document);
      if (res.found && res.box) {
        targetBox = res.box;
      }
    }

    if (targetBox) {
      this.boxElement.style.display = "block";
      this.boxElement.style.left = `${targetBox.x}px`;
      this.boxElement.style.top = `${targetBox.y}px`;
      this.boxElement.style.width = `${targetBox.width}px`;
      this.boxElement.style.height = `${targetBox.height}px`;

      this.captionElement.style.display = "block";
      this.captionElement.style.left = `${targetBox.x}px`;
      this.captionElement.style.top = `${targetBox.y}px`;
      this.captionElement.textContent = `${caption}: ${action.locator?.name || action.locator?.role || ""}`;

      if (action.type === "browser_click") {
        this.boxElement.classList.add("click-pulse");
      } else {
        this.boxElement.classList.remove("click-pulse");
      }
    }

    // Auto-clear preview after 1.5s
    this.clearTimer = setTimeout(() => {
      this.clear();
    }, 1500);
  }

  public clear(): void {
    if (this.boxElement) this.boxElement.style.display = "none";
    if (this.captionElement) this.captionElement.style.display = "none";
  }
}
