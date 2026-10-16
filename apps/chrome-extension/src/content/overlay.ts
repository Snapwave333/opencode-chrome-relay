import { OVERLAY_CONTAINER_ID, COLORS, M3_COLORS } from "../shared/constants.js";
import { ActionPayload } from "@opencode/chrome-relay-protocol";
import { resolveElementLocator } from "../browser/locators.js";
import { getMaterial3Svg, Material3IconName } from "../shared/material_icons.js";

export class ActionOverlay {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private boxElement: HTMLDivElement | null = null;
  private captionElement: HTMLDivElement | null = null;
  private rippleElement: HTMLDivElement | null = null;
  private topProgressBar: HTMLDivElement | null = null;
  private edgeScrollMarker: HTMLDivElement | null = null;
  private floatingToast: HTMLDivElement | null = null;
  private scanLineElement: HTMLDivElement | null = null;
  private clearTimer: any = null;

  public init(): void {
    if (document.getElementById(OVERLAY_CONTAINER_ID)) {
      return;
    }

    this.container = document.createElement("div");
    this.container.id = OVERLAY_CONTAINER_ID;
    this.container.style.cssText =
      "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647; overflow: hidden;";

    this.shadow = this.container.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }

      /* Target Outline Box (M3 Elevation & Cyan Glow) */
      .highlight-box {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid ${M3_COLORS.primary};
        border-radius: 8px;
        background: rgba(128, 213, 232, 0.12);
        box-shadow: 0 0 16px rgba(128, 213, 232, 0.35);
        transition: all 0.22s cubic-bezier(0.05, 0.7, 0.1, 1);
        pointer-events: none;
        display: none;
      }
      .highlight-box.type-mode {
        border-color: ${M3_COLORS.primary};
        background: rgba(128, 213, 232, 0.18);
        border-style: dashed;
      }
      .highlight-box.verified {
        border-color: ${M3_COLORS.success};
        background: rgba(124, 217, 146, 0.16);
        box-shadow: 0 0 18px rgba(124, 217, 146, 0.5);
      }
      .highlight-box.failed {
        border-color: ${M3_COLORS.error};
        background: rgba(255, 180, 171, 0.16);
        box-shadow: 0 0 18px rgba(255, 180, 171, 0.5);
      }

      /* Target Action Caption Badge: M3 Pill Chip */
      .caption-badge {
        position: absolute;
        display: none;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.15px;
        color: ${M3_COLORS.onSurface};
        background: ${M3_COLORS.surfaceContainer};
        border: 1px solid ${M3_COLORS.primary};
        border-radius: 9999px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.65), 0 0 10px rgba(128, 213, 232, 0.25);
        white-space: nowrap;
        pointer-events: none;
        transform: translateY(-100%);
        margin-top: -8px;
        transition: all 0.16s ease;
      }
      .caption-badge.verified {
        border-color: ${M3_COLORS.success};
        color: ${M3_COLORS.success};
        background: ${M3_COLORS.surfaceContainerHigh};
      }
      .caption-badge.failed {
        border-color: ${M3_COLORS.error};
        color: ${M3_COLORS.error};
        background: ${M3_COLORS.surfaceContainerHigh};
      }

      /* Localized Click Ripple: M3 Spring Expansion */
      .click-ripple {
        position: absolute;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(128, 213, 232, 0.85) 0%, rgba(128, 213, 232, 0) 70%);
        pointer-events: none;
        display: none;
        transform: translate(-50%, -50%) scale(0);
        animation: rippleEffect 0.45s cubic-bezier(0.05, 0.7, 0.1, 1) forwards;
      }
      @keyframes rippleEffect {
        0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.95; }
        100% { transform: translate(-50%, -50%) scale(2.8); opacity: 0; }
      }

      /* Navigation Top Progress Bar */
      .top-progress-bar {
        position: fixed;
        top: 0;
        left: 0;
        height: 3px;
        width: 0%;
        background: linear-gradient(90deg, ${M3_COLORS.primary}, ${M3_COLORS.onPrimaryContainer});
        box-shadow: 0 0 10px ${M3_COLORS.primary};
        pointer-events: none;
        transition: width 0.3s ease;
        display: none;
        z-index: 2147483647;
      }

      /* Edge Scroll Direction Marker: M3 Floating Pill Badge */
      .edge-scroll-marker {
        position: fixed;
        display: none;
        align-items: center;
        gap: 6px;
        justify-content: center;
        background: ${M3_COLORS.surfaceContainer};
        border: 1px solid ${M3_COLORS.primary};
        color: ${M3_COLORS.primary};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 9999px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55), 0 0 12px rgba(128, 213, 232, 0.3);
        pointer-events: none;
        z-index: 2147483647;
      }

      /* Floating Action Toast (Downloads/Uploads/Waiting) */
      .floating-toast {
        position: fixed;
        bottom: 24px;
        left: 24px;
        display: none;
        align-items: center;
        gap: 8px;
        background: ${M3_COLORS.surfaceContainerHigh};
        border: 1px solid ${M3_COLORS.primary};
        color: ${M3_COLORS.onSurface};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        padding: 8px 16px;
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.7);
        pointer-events: none;
        z-index: 2147483647;
        animation: toastFadeIn 0.22s cubic-bezier(0.05, 0.7, 0.1, 1);
      }
      @keyframes toastFadeIn {
        from { opacity: 0; transform: translateY(12px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* Scanning Sweep Line (Vision Inspection) */
      .scan-line {
        position: absolute;
        height: 2px;
        width: 100%;
        background: linear-gradient(90deg, transparent, ${M3_COLORS.primary}, transparent);
        box-shadow: 0 0 10px ${M3_COLORS.primary};
        display: none;
        animation: scanSweep 1.2s infinite ease-in-out;
      }
      @keyframes scanSweep {
        0% { top: 0%; opacity: 0.2; }
        50% { opacity: 0.95; }
        100% { top: 100%; opacity: 0.2; }
      }
    `;

    this.boxElement = document.createElement("div");
    this.boxElement.className = "highlight-box";

    this.captionElement = document.createElement("div");
    this.captionElement.className = "caption-badge";

    this.rippleElement = document.createElement("div");
    this.rippleElement.className = "click-ripple";

    this.topProgressBar = document.createElement("div");
    this.topProgressBar.className = "top-progress-bar";

    this.edgeScrollMarker = document.createElement("div");
    this.edgeScrollMarker.className = "edge-scroll-marker";

    this.floatingToast = document.createElement("div");
    this.floatingToast.className = "floating-toast";

    this.scanLineElement = document.createElement("div");
    this.scanLineElement.className = "scan-line";
    this.boxElement.appendChild(this.scanLineElement);

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.boxElement);
    this.shadow.appendChild(this.captionElement);
    this.shadow.appendChild(this.rippleElement);
    this.shadow.appendChild(this.topProgressBar);
    this.shadow.appendChild(this.edgeScrollMarker);
    this.shadow.appendChild(this.floatingToast);

    document.documentElement.appendChild(this.container);
  }

  public showActionPreview(action: ActionPayload): void {
    if (!this.shadow) this.init();
    if (this.clearTimer) clearTimeout(this.clearTimer);

    // Reset modifier classes
    this.boxElement?.classList.remove("type-mode", "verified", "failed");
    this.captionElement?.classList.remove("verified", "failed");
    if (this.scanLineElement) this.scanLineElement.style.display = "none";

    let iconName: Material3IconName = "search";
    let captionText = "Inspecting";

    switch (action.type) {
      case "browser_click":
        iconName = "touch_app";
        captionText = "Clicking";
        break;
      case "browser_type":
        iconName = "keyboard";
        const masked = action.text && action.text.length > 0 ? "••••••" : "";
        captionText = `Typing "${masked}"`;
        this.boxElement?.classList.add("type-mode");
        break;
      case "browser_keypress":
        iconName = "keyboard_alt";
        captionText = `Pressing [${action.key || "Key"}]`;
        break;
      case "browser_scroll":
        this.showScrollMarker(action.scroll_direction || "down", action.scroll_amount || 400);
        return;
      case "browser_navigate":
        this.showNavigationProgress(action.url || "");
        return;
      case "browser_download":
        this.showToast("download", `Downloading: ${action.download_path || action.url || "file"}...`);
        return;
      case "browser_upload":
        const fileCount = action.file_paths?.length || 1;
        this.showToast("upload", `Uploading ${fileCount} file(s)...`);
        break;
      case "browser_wait":
        this.showToast("hourglass_top", `Waiting: ${action.predicate || "for condition"} (${action.timeout_ms || 5000}ms)`);
        return;
      case "browser_screenshot":
        iconName = "photo_camera";
        captionText = "Vision Grounding (NVIDIA NIM)";
        if (this.scanLineElement) this.scanLineElement.style.display = "block";
        break;
      default:
        iconName = "search";
        captionText = "Inspecting";
    }

    // Resolve target box
    let targetBox: any = null;
    if (action.locator) {
      const res = resolveElementLocator(action.locator, document);
      if (res.found && res.box) {
        targetBox = res.box;
      }
    }

    if (targetBox && this.boxElement && this.captionElement) {
      this.boxElement.style.display = "block";
      this.boxElement.style.left = `${Math.max(0, targetBox.x - 2)}px`;
      this.boxElement.style.top = `${Math.max(0, targetBox.y - 2)}px`;
      this.boxElement.style.width = `${targetBox.width + 4}px`;
      this.boxElement.style.height = `${targetBox.height + 4}px`;

      this.captionElement.style.display = "flex";
      this.captionElement.style.left = `${Math.max(4, targetBox.x)}px`;
      this.captionElement.style.top = `${Math.max(20, targetBox.y)}px`;
      const targetLabel = action.locator?.name || action.locator?.role || "";
      this.captionElement.innerHTML = `${getMaterial3Svg(iconName, 14)} <span>${captionText}${targetLabel ? ": " + targetLabel : ""}</span>`;

      if (action.type === "browser_click" && this.rippleElement) {
        this.rippleElement.style.left = `${targetBox.centerX}px`;
        this.rippleElement.style.top = `${targetBox.centerY}px`;
        this.rippleElement.style.width = "48px";
        this.rippleElement.style.height = "48px";
        this.rippleElement.style.display = "block";
      }
    }

    this.clearTimer = setTimeout(() => this.clear(), 1800);
  }

  public showActionOutcome(success: boolean, message?: string): void {
    if (!this.boxElement || !this.captionElement) return;

    if (success) {
      this.boxElement.classList.add("verified");
      this.captionElement.classList.add("verified");
      this.captionElement.innerHTML = `${getMaterial3Svg("check_circle", 14)} <span>Verified ${message || ""}</span>`;
    } else {
      this.boxElement.classList.add("failed");
      this.captionElement.classList.add("failed");
      this.captionElement.innerHTML = `${getMaterial3Svg("cancel", 14)} <span>Failed: ${message || "Action not confirmed"}</span>`;
    }

    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clear(), 1200);
  }

  private showNavigationProgress(url: string): void {
    if (!this.topProgressBar) return;
    this.topProgressBar.style.display = "block";
    this.topProgressBar.style.width = "35%";

    this.showToast("language", `Navigating to: ${url}`);

    setTimeout(() => {
      if (this.topProgressBar) this.topProgressBar.style.width = "85%";
    }, 200);

    setTimeout(() => {
      if (this.topProgressBar) {
        this.topProgressBar.style.width = "100%";
        setTimeout(() => {
          if (this.topProgressBar) this.topProgressBar.style.display = "none";
        }, 300);
      }
    }, 600);
  }

  private showScrollMarker(direction: string, amount: number): void {
    if (!this.edgeScrollMarker) return;
    const arrowIcon: Material3IconName =
      direction === "down"
        ? "arrow_downward"
        : direction === "up"
        ? "arrow_upward"
        : direction === "right"
        ? "arrow_forward"
        : "arrow_back";

    this.edgeScrollMarker.innerHTML = `${getMaterial3Svg(arrowIcon, 15)} <span>Scrolling ${direction.toUpperCase()} (${amount}px)</span>`;
    this.edgeScrollMarker.style.display = "flex";

    if (direction === "down") {
      this.edgeScrollMarker.style.bottom = "20px";
      this.edgeScrollMarker.style.top = "auto";
      this.edgeScrollMarker.style.left = "50%";
      this.edgeScrollMarker.style.transform = "translateX(-50%)";
    } else if (direction === "up") {
      this.edgeScrollMarker.style.top = "20px";
      this.edgeScrollMarker.style.bottom = "auto";
      this.edgeScrollMarker.style.left = "50%";
      this.edgeScrollMarker.style.transform = "translateX(-50%)";
    } else {
      this.edgeScrollMarker.style.bottom = "20px";
      this.edgeScrollMarker.style.left = "50%";
      this.edgeScrollMarker.style.transform = "translateX(-50%)";
    }

    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.edgeScrollMarker) this.edgeScrollMarker.style.display = "none";
    }, 1200);
  }

  public showToast(iconName: Material3IconName, text: string, durationMs = 2000): void {
    if (!this.floatingToast) return;
    this.floatingToast.innerHTML = `${getMaterial3Svg(iconName, 16)} <span>${text}</span>`;
    this.floatingToast.style.display = "flex";

    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.floatingToast) this.floatingToast.style.display = "none";
    }, durationMs);
  }

  public clear(): void {
    if (this.boxElement) this.boxElement.style.display = "none";
    if (this.captionElement) this.captionElement.style.display = "none";
    if (this.rippleElement) this.rippleElement.style.display = "none";
    if (this.topProgressBar) this.topProgressBar.style.display = "none";
    if (this.edgeScrollMarker) this.edgeScrollMarker.style.display = "none";
    if (this.floatingToast) this.floatingToast.style.display = "none";
  }
}
