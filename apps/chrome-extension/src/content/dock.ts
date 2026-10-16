import { DOCK_CONTAINER_ID, COLORS } from "../shared/constants.js";
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
      "position: fixed; bottom: 20px; right: 20px; z-index: 2147483646; pointer-events: auto;";

    this.shadow = this.container.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .dock-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        background: ${COLORS.surfaceDark};
        border: 1px solid ${COLORS.borderDark};
        padding: 6px 10px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .dock-btn {
        background: transparent;
        color: ${COLORS.textDark};
        border: 1px solid ${COLORS.borderDark};
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.1s ease;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .dock-btn:hover {
        background: ${COLORS.borderDark};
        color: #fff;
      }
      .btn-pause { border-color: ${COLORS.cyanPrimary}; color: ${COLORS.cyanPrimary}; }
      .btn-stop { border-color: ${COLORS.errorRed}; color: ${COLORS.errorRed}; }
      .btn-steer { border-color: ${COLORS.magentaSteer}; color: ${COLORS.magentaSteer}; }
      .dismiss-btn {
        background: none;
        border: none;
        color: ${COLORS.textMuted};
        cursor: pointer;
        padding: 2px 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .dismiss-btn:hover {
        color: #fff;
      }
    `;

    const dock = document.createElement("div");
    dock.className = "dock-bar";

    const btnPause = document.createElement("button");
    btnPause.className = "dock-btn btn-pause";
    btnPause.innerHTML = `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
    btnPause.onclick = () => onControl("pause");

    const btnStop = document.createElement("button");
    btnStop.className = "dock-btn btn-stop";
    btnStop.innerHTML = `${getMaterial3Svg("stop", 12)} <span>STOP</span>`;
    btnStop.onclick = () => onControl("stop");

    const btnSteer = document.createElement("button");
    btnSteer.className = "dock-btn btn-steer";
    btnSteer.innerHTML = `${getMaterial3Svg("send", 12)} <span>STEER</span>`;
    btnSteer.onclick = () => onControl("steer");

    const btnDismiss = document.createElement("button");
    btnDismiss.className = "dismiss-btn";
    btnDismiss.innerHTML = getMaterial3Svg("close", 14);
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
