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
      @keyframes dockEntrance {
        0% { opacity: 0; transform: translateY(20px) scale(0.92); }
        60% { opacity: 1; transform: translateY(-3px) scale(1.02); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes borderGlow {
        0%, 100% { border-color: rgba(137, 147, 150, 0.28); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(128, 213, 232, 0.2); }
        50% { border-color: rgba(128, 213, 232, 0.55); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75), 0 0 24px rgba(128, 213, 232, 0.45); }
      }
      @keyframes beaconPulse {
        0% { transform: scale(0.95); opacity: 0.9; box-shadow: 0 0 0 0 rgba(124, 217, 146, 0.7); }
        70% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 0 6px rgba(124, 217, 146, 0); }
        100% { transform: scale(0.95); opacity: 0.9; box-shadow: 0 0 0 0 rgba(124, 217, 146, 0); }
      }
      @keyframes iconWiggle {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-8deg) scale(1.1); }
        75% { transform: rotate(8deg) scale(1.1); }
      }

      .dock-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(27, 34, 37, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(137, 147, 150, 0.28);
        padding: 6px 14px;
        border-radius: 9999px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(128, 213, 232, 0.2);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: dockEntrance 0.36s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, borderGlow 4s infinite ease-in-out;
        will-change: transform, opacity;
      }
      .dock-beacon {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: ${M3_COLORS.success};
        display: inline-block;
        margin-right: 2px;
        animation: beaconPulse 2s infinite ease-in-out;
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
        transition: transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .dock-btn svg {
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .dock-btn:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), 0 0 8px rgba(128, 213, 232, 0.25);
      }
      .dock-btn:hover svg {
        animation: iconWiggle 0.4s ease-in-out;
      }
      .dock-btn:active {
        transform: translateY(1px) scale(0.93);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
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
        background: rgba(255, 183, 77, 0.26);
        border-color: rgba(255, 183, 77, 0.7);
      }
      .btn-stop {
        border-color: rgba(255, 180, 171, 0.4);
        color: ${M3_COLORS.error};
        background: rgba(255, 180, 171, 0.12);
      }
      .btn-stop:hover {
        background: ${M3_COLORS.errorContainer};
        color: #ffffff;
        border-color: ${M3_COLORS.error};
      }
      .btn-steer {
        border: none;
        color: ${M3_COLORS.onTertiaryContainer};
        background: ${M3_COLORS.tertiaryContainer};
      }
      .btn-steer:hover {
        background: ${M3_COLORS.tertiary};
        color: ${M3_COLORS.onTertiary};
        box-shadow: 0 0 12px rgba(255, 176, 202, 0.5);
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
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.15s ease, color 0.15s ease;
      }
      .dismiss-btn:hover {
        background: rgba(137, 147, 150, 0.25);
        color: ${M3_COLORS.onSurface};
        transform: rotate(90deg) scale(1.12);
      }
      .dismiss-btn:active {
        transform: rotate(90deg) scale(0.9);
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
        .dock-bar,
        .dock-btn,
        .dismiss-btn,
        .dock-beacon {
          animation: none !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;

    const dock = document.createElement("div");
    dock.className = "dock-bar";
    dock.role = "toolbar";
    dock.setAttribute("aria-label", "Relay execution controls");

    const beacon = document.createElement("span");
    beacon.className = "dock-beacon";
    beacon.title = "Relay Agent Active";

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

    dock.appendChild(beacon);
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
