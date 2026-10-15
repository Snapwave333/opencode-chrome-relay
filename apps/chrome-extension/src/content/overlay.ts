import { OVERLAY_CONTAINER_ID, COLORS } from "../shared/constants.js";
import { ActionPayload } from "@opencode/chrome-relay-protocol";
import { resolveElementLocator } from "../browser/locators.js";

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

      /* Target Outline Box */
      .highlight-box {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid ${COLORS.cyanPrimary};
        border-radius: 5px;
        background: rgba(0, 212, 255, 0.12);
        box-shadow: 0 0 12px rgba(0, 212, 255, 0.45);
        transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
        display: none;
      }
      .highlight-box.type-mode {
        border-color: ${COLORS.cyanPrimary};
        background: rgba(0, 212, 255, 0.18);
        border-style: dashed;
      }
      .highlight-box.verified {
        border-color: ${COLORS.successGreen};
        background: rgba(46, 160, 67, 0.16);
        box-shadow: 0 0 14px rgba(46, 160, 67, 0.5);
      }
      .highlight-box.failed {
        border-color: ${COLORS.errorRed};
        background: rgba(248, 81, 73, 0.16);
        box-shadow: 0 0 14px rgba(248, 81, 73, 0.5);
      }

      /* Target Action Caption Badge */
      .caption-badge {
        position: absolute;
        display: none;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.2px;
        color: #ffffff;
        background: #0d1117;
        border: 1px solid ${COLORS.cyanPrimary};
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
        white-space: nowrap;
        pointer-events: none;
        transform: translateY(-100%);
        margin-top: -6px;
        transition: opacity 0.12s ease;
      }
      .caption-badge.verified {
        border-color: ${COLORS.successGreen};
        color: ${COLORS.successGreen};
      }
      .caption-badge.failed {
        border-color: ${COLORS.errorRed};
        color: ${COLORS.errorRed};
      }

      /* Localized Click Ripple */
      .click-ripple {
        position: absolute;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(0,212,255,0.7) 0%, rgba(0,212,255,0) 70%);
        pointer-events: none;
        display: none;
        transform: translate(-50%, -50%) scale(0);
        animation: rippleEffect 0.42s cubic-bezier(0, 0.7, 0.1, 1) forwards;
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
        background: linear-gradient(90deg, ${COLORS.cyanPrimary}, #79c0ff);
        box-shadow: 0 0 10px ${COLORS.cyanPrimary};
        pointer-events: none;
        transition: width 0.3s ease;
        display: none;
        z-index: 2147483647;
      }

      /* Edge Scroll Direction Marker */
      .edge-scroll-marker {
        position: fixed;
        display: none;
        align-items: center;
        justify-content: center;
        background: #0d1117;
        border: 1px solid ${COLORS.cyanPrimary};
        color: ${COLORS.cyanPrimary};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
        font-size: 13px;
        font-weight: 700;
        padding: 6px 14px;
        border-radius: 20px;
        box-shadow: 0 4px 16px rgba(0, 212, 255, 0.35);
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
        background: #161b22;
        border: 1px solid ${COLORS.cyanPrimary};
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        padding: 8px 14px;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
        pointer-events: none;
        z-index: 2147483647;
        animation: toastFadeIn 0.2s ease;
      }
      @keyframes toastFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Scanning Sweep Line (Vision Inspection) */
      .scan-line {
        position: absolute;
        height: 2px;
        width: 100%;
        background: linear-gradient(90deg, transparent, ${COLORS.cyanPrimary}, transparent);
        box-shadow: 0 0 8px ${COLORS.cyanPrimary};
        display: none;
        animation: scanSweep 1.2s infinite ease-in-out;
      }
      @keyframes scanSweep {
        0% { top: 0%; opacity: 0.2; }
        50% { opacity: 0.9; }
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

    let icon = "🔍";
    let captionText = "Inspecting";

    switch (action.type) {
      case "browser_click":
        icon = "👆";
        captionText = "Clicking";
        break;
      case "browser_type":
        icon = "⌨️";
        const masked = action.text && action.text.length > 0 ? "••••••" : "";
        captionText = `Typing "${masked}"`;
        this.boxElement?.classList.add("type-mode");
        break;
      case "browser_keypress":
        icon = "⌨️";
        captionText = `Pressing [${action.key || "Key"}]`;
        break;
      case "browser_scroll":
        this.showScrollMarker(action.scroll_direction || "down", action.scroll_amount || 400);
        return;
      case "browser_navigate":
        this.showNavigationProgress(action.url || "");
        return;
      case "browser_download":
        this.showToast("📥", `Downloading: ${action.download_path || action.url || "file"}...`);
        return;
      case "browser_upload":
        const fileCount = action.file_paths?.length || 1;
        this.showToast("📤", `Uploading ${fileCount} file(s)...`);
        break;
      case "browser_wait":
        this.showToast("⏳", `Waiting: ${action.predicate || "for condition"} (${action.timeout_ms || 5000}ms)`);
        return;
      case "browser_screenshot":
        icon = "🎯";
        captionText = "Vision Grounding (NVIDIA NIM)";
        if (this.scanLineElement) this.scanLineElement.style.display = "block";
        break;
      default:
        icon = "🔍";
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
      this.captionElement.textContent = `${icon} ${captionText}: ${action.locator?.name || action.locator?.role || ""}`;

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
      this.captionElement.textContent = `✓ Verified ${message || ""}`;
    } else {
      this.boxElement.classList.add("failed");
      this.captionElement.classList.add("failed");
      this.captionElement.textContent = `✗ Failed: ${message || "Action not confirmed"}`;
    }

    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clear(), 1200);
  }

  private showNavigationProgress(url: string): void {
    if (!this.topProgressBar) return;
    this.topProgressBar.style.display = "block";
    this.topProgressBar.style.width = "35%";

    this.showToast("🧭", `Navigating to: ${url}`);

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
    const arrow = direction === "down" ? "↓" : direction === "up" ? "↑" : direction === "right" ? "→" : "←";
    this.edgeScrollMarker.textContent = `${arrow} Scrolling ${direction.toUpperCase()} (${amount}px)`;
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

  public showToast(icon: string, text: string, durationMs = 2000): void {
    if (!this.floatingToast) return;
    this.floatingToast.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
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
