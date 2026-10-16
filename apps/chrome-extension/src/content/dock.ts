import { DOCK_CONTAINER_ID, M3_COLORS } from "../shared/constants.js";
import { getMaterial3Svg } from "../shared/material_icons.js";

export class InPageDock {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;

  public init(onControl: (command: string) => void): void {
    if (document.getElementById(DOCK_CONTAINER_ID)) {
      return;
    }

    this.container = document.createElement("div");
    this.container.id = DOCK_CONTAINER_ID;
    this.container.style.cssText =
      "position: fixed; bottom: 24px; right: 24px; z-index: 2147483646; pointer-events: auto;";

    this.shadow = this.container.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .dock-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(27, 34, 37, 0.88);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(137, 147, 150, 0.28);
        padding: 6px 12px;
        border-radius: 9999px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(128, 213, 232, 0.2);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .dock-btn {
        background: ${M3_COLORS.surfaceContainerHigh};
        color: ${M3_COLORS.onSurface};
        border: 1px solid rgba(137, 147, 150, 0.25);
        min-height: 34px;
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
        border-radius: 9999px;
        cursor: pointer;
        transition: all 0.22s cubic-bezier(0.05, 0.7, 0.1, 1);
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .dock-btn:hover {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }
      .dock-btn:active,
      .dismiss-btn:active {
        transform: scale(0.96);
      }
      .dock-btn:focus-visible,
      .dismiss-btn:focus-visible {
        outline: 2px solid ${M3_COLORS.primary};
        outline-offset: 2px;
      }
      .btn-pause {
        border-color: rgba(255, 183, 77, 0.4);
        color: #ffb74d;
        background: rgba(255, 183, 77, 0.12);
      }
      .btn-pause:hover {
        background: rgba(255, 183, 77, 0.24);
      }
      .btn-stop {
        border-color: rgba(255, 180, 171, 0.4);
        color: ${M3_COLORS.error};
        background: rgba(255, 180, 171, 0.12);
      }
      .btn-stop:hover {
        background: ${M3_COLORS.errorContainer};
        color: #ffffff;
      }
      .btn-steer {
        border: none;
        color: ${M3_COLORS.onTertiaryContainer};
        background: ${M3_COLORS.tertiaryContainer};
      }
      .btn-steer:hover {
        background: ${M3_COLORS.tertiary};
        color: ${M3_COLORS.onTertiary};
      }
      .dismiss-btn {
        background: none;
        border: none;
        color: ${M3_COLORS.onSurfaceVariant};
        cursor: pointer;
        width: 30px;
        height: 30px;
        padding: 4px;
        border-radius: 9999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }
      .dismiss-btn:hover {
        background: rgba(137, 147, 150, 0.2);
        color: ${M3_COLORS.onSurface};
      }
      @media (max-width: 520px) {
        .dock-bar {
          gap: 5px;
          padding: 5px 8px;
        }
        .dock-btn {
          padding-inline: 9px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dock-btn,
        .dismiss-btn {
          transition-duration: 0.01ms;
        }
      }
    `;

    const dock = document.createElement("div");
    dock.className = "dock-bar";
    dock.role = "toolbar";
    dock.setAttribute("aria-label", "Relay execution controls");

    const btnPause = document.createElement("button");
    btnPause.className = "dock-btn btn-pause";
    btnPause.innerHTML = `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
    btnPause.title = "Pause agent execution";
    btnPause.onclick = () => onControl("pause");

    const btnStop = document.createElement("button");
    btnStop.className = "dock-btn btn-stop";
    btnStop.innerHTML = `${getMaterial3Svg("stop", 12)} <span>STOP</span>`;
    btnStop.title = "Stop agent execution";
    btnStop.onclick = () => onControl("stop");

    const btnSteer = document.createElement("button");
    btnSteer.className = "dock-btn btn-steer";
    btnSteer.innerHTML = `${getMaterial3Svg("send", 12)} <span>STEER</span>`;
    btnSteer.title = "Send a new instruction";
    btnSteer.onclick = () => onControl("steer");

    const btnDismiss = document.createElement("button");
    btnDismiss.className = "dismiss-btn";
    btnDismiss.innerHTML = getMaterial3Svg("close", 14);
    btnDismiss.title = "Dismiss controls";
    btnDismiss.setAttribute("aria-label", "Dismiss relay controls");
    btnDismiss.onclick = () => this.hide();

    dock.appendChild(btnPause);
    dock.appendChild(btnStop);
    dock.appendChild(btnSteer);
    dock.appendChild(btnDismiss);

    this.shadow.appendChild(style);
    this.shadow.appendChild(dock);
    document.documentElement.appendChild(this.container);
  }

  public hide(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
