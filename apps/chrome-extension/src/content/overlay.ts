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
  private shockwaveElement: HTMLDivElement | null = null;
  private agentCursor: HTMLDivElement | null = null;
  private cursorBadgeText: HTMLSpanElement | null = null;
  private typingHudElement: HTMLDivElement | null = null;
  private typingHudText: HTMLSpanElement | null = null;
  private typingHudCount: HTMLSpanElement | null = null;
  private keypressHudElement: HTMLDivElement | null = null;
  private downloadHudElement: HTMLDivElement | null = null;
  private topProgressBar: HTMLDivElement | null = null;
  private edgeScrollMarker: HTMLDivElement | null = null;
  private floatingToast: HTMLDivElement | null = null;
  private scanLineElement: HTMLDivElement | null = null;
  private clearTimer: any = null;
  private currentCursorX: number = 0;
  private currentCursorY: number = 0;

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

      @keyframes targetAcquire {
        0% { transform: scale(0.97); opacity: 0.4; }
        60% { transform: scale(1.02); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes targetBreathe {
        0%, 100% { box-shadow: 0 0 16px rgba(128, 213, 232, 0.35); }
        50% { box-shadow: 0 0 28px rgba(128, 213, 232, 0.65); }
      }
      @keyframes verifiedPop {
        0% { transform: scale(0.96); box-shadow: 0 0 10px rgba(124, 217, 146, 0.4); }
        50% { transform: scale(1.03); box-shadow: 0 0 32px rgba(124, 217, 146, 0.9); }
        100% { transform: scale(1); box-shadow: 0 0 22px rgba(124, 217, 146, 0.6); }
      }
      @keyframes badgePop {
        0% { transform: translateY(-70%) scale(0.85); opacity: 0; }
        65% { transform: translateY(-105%) scale(1.04); opacity: 1; }
        100% { transform: translateY(-100%) scale(1); opacity: 1; }
      }
      @keyframes cornerSnapTL { from { transform: translate(-5px, -5px); opacity: 0; } to { transform: translate(0, 0); opacity: 1; } }
      @keyframes cornerSnapTR { from { transform: translate(5px, -5px); opacity: 0; } to { transform: translate(0, 0); opacity: 1; } }
      @keyframes cornerSnapBL { from { transform: translate(-5px, 5px); opacity: 0; } to { transform: translate(0, 0); opacity: 1; } }
      @keyframes cornerSnapBR { from { transform: translate(5px, 5px); opacity: 0; } to { transform: translate(0, 0); opacity: 1; } }

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
        animation: targetAcquire 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), targetBreathe 2.4s infinite ease-in-out;
      }
      .highlight-box.type-mode {
        border-color: ${M3_COLORS.primary};
        background: rgba(128, 213, 232, 0.16);
        border-style: dashed;
        animation: typeFocusRing 1.2s infinite ease-in-out;
      }
      @keyframes typeFocusRing {
        0%, 100% { box-shadow: 0 0 12px rgba(128, 213, 232, 0.3); }
        50% { box-shadow: 0 0 24px rgba(128, 213, 232, 0.65); }
      }
      .highlight-box.hover-mode {
        border-color: ${M3_COLORS.secondary};
        background: rgba(177, 203, 209, 0.14);
        box-shadow: 0 0 20px rgba(177, 203, 209, 0.45);
      }
      .highlight-box.verified {
        border-color: ${M3_COLORS.success};
        background: rgba(124, 217, 146, 0.18);
        box-shadow: 0 0 22px rgba(124, 217, 146, 0.6);
        animation: verifiedPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      }
      .highlight-box.failed {
        border-color: ${M3_COLORS.error};
        background: rgba(255, 180, 171, 0.18);
        box-shadow: 0 0 22px rgba(255, 180, 171, 0.6);
        animation: shakeTarget 0.35s ease-in-out;
      }
      @keyframes shakeTarget {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-5px); }
        40%, 80% { transform: translateX(5px); }
      }

      /* Corner Reticle Brackets */
      .box-bracket {
        position: absolute;
        width: 10px;
        height: 10px;
        border-color: #ffffff;
        border-style: solid;
        pointer-events: none;
      }
      .box-bracket.tl {
        top: -3px; left: -3px;
        border-width: 2.5px 0 0 2.5px;
        animation: cornerSnapTL 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .box-bracket.tr {
        top: -3px; right: -3px;
        border-width: 2.5px 2.5px 0 0;
        animation: cornerSnapTR 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .box-bracket.bl {
        bottom: -3px; left: -3px;
        border-width: 0 0 2.5px 2.5px;
        animation: cornerSnapBL 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .box-bracket.br {
        bottom: -3px; right: -3px;
        border-width: 0 2.5px 2.5px 0;
        animation: cornerSnapBR 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
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
        animation: badgePop 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
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

      /* Localized Click Ripple */
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

      /* Multi-Ring Expanding Click Shockwave */
      .click-shockwave {
        position: absolute;
        pointer-events: none;
        display: none;
        transform: translate(-50%, -50%);
        width: 0;
        height: 0;
      }
      .shockwave-burst {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 0 16px ${M3_COLORS.primary};
        transform: translate(-50%, -50%) scale(1);
        animation: burstFade 0.35s ease-out forwards;
      }
      .shockwave-ring-1 {
        position: absolute;
        top: 50%;
        left: 50%;
        border-radius: 50%;
        border: 2.5px solid ${M3_COLORS.primary};
        box-shadow: 0 0 16px ${M3_COLORS.primary}, inset 0 0 10px ${M3_COLORS.primary};
        transform: translate(-50%, -50%) scale(0.1);
        animation: shockwaveExpand1 0.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
      }
      .shockwave-ring-2 {
        position: absolute;
        top: 50%;
        left: 50%;
        border-radius: 50%;
        border: 1.5px solid rgba(128, 213, 232, 0.7);
        box-shadow: 0 0 24px rgba(128, 213, 232, 0.4);
        transform: translate(-50%, -50%) scale(0.1);
        animation: shockwaveExpand2 0.65s 0.08s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
      }
      @keyframes shockwaveExpand1 {
        0% { width: 10px; height: 10px; opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
        100% { width: 72px; height: 72px; opacity: 0; transform: translate(-50%, -50%) scale(1); }
      }
      @keyframes shockwaveExpand2 {
        0% { width: 10px; height: 10px; opacity: 0.9; transform: translate(-50%, -50%) scale(0.2); }
        100% { width: 125px; height: 125px; opacity: 0; transform: translate(-50%, -50%) scale(1); }
      }
      @keyframes burstFade {
        0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
      }

      /* Animated Agent Pointer / Ghost Cursor */
      .agent-cursor {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 2147483647;
        display: none;
        transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
        will-change: transform;
      }
      .cursor-pointer {
        position: absolute;
        top: 0;
        left: 0;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.65)) drop-shadow(0 0 8px rgba(128, 213, 232, 0.5));
        transition: transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .agent-cursor.clicking .cursor-pointer {
        animation: cursorClickSquash 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      @keyframes cursorClickSquash {
        0% { transform: scale(1) rotate(0deg); }
        35% { transform: scale(0.72, 0.72) translate(-3px, -3px) rotate(-14deg); }
        70% { transform: scale(1.08, 1.08) translate(-1px, -1px) rotate(-4deg); }
        100% { transform: scale(1) rotate(0deg); }
      }
      .cursor-badge {
        position: absolute;
        left: 18px;
        top: 14px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px;
        background: rgba(27, 34, 37, 0.94);
        border: 1px solid rgba(128, 213, 232, 0.65);
        border-radius: 9999px;
        color: ${M3_COLORS.primary};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.2px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.65), 0 0 10px rgba(128, 213, 232, 0.35);
        white-space: nowrap;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .cursor-badge.typing {
        border-color: ${M3_COLORS.tertiary};
        color: ${M3_COLORS.tertiary};
      }
      .cursor-badge.hovering {
        border-color: ${M3_COLORS.secondary};
        color: ${M3_COLORS.onSecondaryContainer};
      }
      .cursor-badge.verified {
        border-color: ${M3_COLORS.success};
        color: ${M3_COLORS.success};
      }
      .cursor-aura {
        position: absolute;
        top: -12px;
        left: -12px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(128, 213, 232, 0.45) 0%, rgba(128, 213, 232, 0) 70%);
        pointer-events: none;
        animation: auraPulse 2s infinite ease-in-out;
      }
      @keyframes auraPulse {
        0%, 100% { transform: scale(1); opacity: 0.4; }
        50% { transform: scale(1.6); opacity: 0.8; }
      }

      /* Monospace Floating Typing HUD Pill */
      .typing-hud {
        position: absolute;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(27, 34, 37, 0.94);
        border: 1.5px solid ${M3_COLORS.primary};
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.75), 0 0 18px rgba(128, 213, 232, 0.35);
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 12px;
        color: ${M3_COLORS.onSurface};
        pointer-events: none;
        z-index: 2147483647;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        animation: typingHudPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        white-space: nowrap;
      }
      @keyframes typingHudPop {
        from { opacity: 0; transform: translateY(-8px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .typing-hud-icon {
        display: inline-flex;
        align-items: center;
        color: ${M3_COLORS.primary};
        animation: keyHop 0.4s infinite alternate ease-in-out;
      }
      @keyframes keyHop {
        0% { transform: translateY(0); }
        100% { transform: translateY(-2px); }
      }
      .typing-hud-text {
        color: ${M3_COLORS.onPrimaryContainer};
        font-weight: 600;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .typing-hud-caret {
        display: inline-block;
        width: 2px;
        height: 13px;
        background: ${M3_COLORS.primary};
        margin-left: 2px;
        animation: blinkCaret 0.8s infinite;
      }
      @keyframes blinkCaret {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
      .typing-hud-count {
        font-size: 10px;
        color: ${M3_COLORS.outline};
        padding-left: 6px;
        border-left: 1px solid rgba(137, 147, 150, 0.3);
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

      /* Floating Action Toast */
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
      /* Keypress Mechanical Keycap HUD */
      .keypress-hud {
        position: fixed;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(22, 27, 34, 0.95);
        border: 1.5px solid ${M3_COLORS.primary};
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(128, 213, 232, 0.45);
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 12px;
        color: #ffffff;
        pointer-events: none;
        z-index: 2147483647;
        backdrop-filter: blur(12px);
        transform: translate(-50%, -100%);
        animation: keypressPop 0.24s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      @keyframes keypressPop {
        from { opacity: 0; transform: translate(-50%, -85%) scale(0.9); }
        to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
      }
      .keypress-keycap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 10px;
        background: #1e262f;
        border: 1px solid rgba(128, 213, 232, 0.6);
        border-bottom: 3px solid ${M3_COLORS.primary};
        border-radius: 6px;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.5);
        color: ${M3_COLORS.primary};
        font-weight: 800;
        letter-spacing: 0.5px;
      }

      /* Animated Download Progress HUD */
      .download-hud {
        position: fixed;
        top: 24px;
        right: 24px;
        display: none;
        align-items: center;
        gap: 10px;
        padding: 10px 18px;
        background: rgba(27, 34, 37, 0.96);
        border: 1.5px solid ${M3_COLORS.primary};
        border-radius: 9999px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.8), 0 0 20px rgba(128, 213, 232, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        pointer-events: none;
        z-index: 2147483647;
        backdrop-filter: blur(12px);
        animation: downloadPop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes downloadPop {
        from { opacity: 0; transform: translateY(-12px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .download-spinner {
        display: inline-block;
        animation: bounceDown 0.7s infinite alternate ease-in-out;
      }
      @keyframes bounceDown {
        0% { transform: translateY(-3px); }
        100% { transform: translateY(3px); }
      }

      /* Cursor Motion Particles */
      .cursor-particle {
        animation: particleFade 0.45s cubic-bezier(0.05, 0.7, 0.1, 1) forwards;
      }
      @keyframes particleFade {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(0.2); opacity: 0; }
      }
    `;

    this.boxElement = document.createElement("div");
    this.boxElement.className = "highlight-box";
    const bTL = document.createElement("div"); bTL.className = "box-bracket tl";
    const bTR = document.createElement("div"); bTR.className = "box-bracket tr";
    const bBL = document.createElement("div"); bBL.className = "box-bracket bl";
    const bBR = document.createElement("div"); bBR.className = "box-bracket br";
    this.boxElement.append(bTL, bTR, bBL, bBR);

    this.captionElement = document.createElement("div");
    this.captionElement.className = "caption-badge";

    this.rippleElement = document.createElement("div");
    this.rippleElement.className = "click-ripple";

    this.shockwaveElement = document.createElement("div");
    this.shockwaveElement.className = "click-shockwave";
    this.shockwaveElement.innerHTML = `
      <div class="shockwave-burst"></div>
      <div class="shockwave-ring-1"></div>
      <div class="shockwave-ring-2"></div>
    `;

    // Construct Agent Cursor
    this.agentCursor = document.createElement("div");
    this.agentCursor.className = "agent-cursor";
    this.agentCursor.innerHTML = `
      <div class="cursor-pointer">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z" fill="url(#agent-cursor-grad)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
          <defs>
            <linearGradient id="agent-cursor-grad" x1="4" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
              <stop stop-color="${M3_COLORS.primary}"/>
              <stop offset="100%" stop-color="${M3_COLORS.primaryContainer}"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div class="cursor-badge">
        <span class="cursor-badge-icon">🤖</span>
        <span class="cursor-badge-text">Agent</span>
      </div>
      <div class="cursor-aura"></div>
    `;
    this.cursorBadgeText = this.agentCursor.querySelector(".cursor-badge-text");

    // Construct Typing HUD
    this.typingHudElement = document.createElement("div");
    this.typingHudElement.className = "typing-hud";
    this.typingHudElement.innerHTML = `
      <span class="typing-hud-icon">${getMaterial3Svg("keyboard", 15)}</span>
      <span class="typing-hud-text"></span>
      <span class="typing-hud-caret"></span>
      <span class="typing-hud-count"></span>
    `;
    this.typingHudText = this.typingHudElement.querySelector(".typing-hud-text");
    this.typingHudCount = this.typingHudElement.querySelector(".typing-hud-count");

    // Construct Keypress HUD
    this.keypressHudElement = document.createElement("div");
    this.keypressHudElement.className = "keypress-hud";

    // Construct Download HUD
    this.downloadHudElement = document.createElement("div");
    this.downloadHudElement.className = "download-hud";

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
    this.shadow.appendChild(this.shockwaveElement);
    this.shadow.appendChild(this.agentCursor);
    this.shadow.appendChild(this.typingHudElement);
    this.shadow.appendChild(this.keypressHudElement);
    this.shadow.appendChild(this.downloadHudElement);
    this.shadow.appendChild(this.topProgressBar);
    this.shadow.appendChild(this.edgeScrollMarker);
    this.shadow.appendChild(this.floatingToast);

    document.documentElement.appendChild(this.container);
  }

  public showActionPreview(action: ActionPayload): void {
    if (!this.shadow) this.init();
    if (this.clearTimer) clearTimeout(this.clearTimer);

    // Reset modifier classes
    this.boxElement?.classList.remove("type-mode", "hover-mode", "verified", "failed");
    this.captionElement?.classList.remove("verified", "failed");
    if (this.scanLineElement) this.scanLineElement.style.display = "none";
    if (this.typingHudElement) this.typingHudElement.style.display = "none";

    let iconName: Material3IconName = "search";
    let captionText = "Inspecting";
    let cursorMode: "default" | "clicking" | "typing" | "hovering" = "default";

    switch (action.type) {
      case "browser_click":
        iconName = "touch_app";
        captionText = "Clicking";
        cursorMode = "clicking";
        break;
      case "browser_type":
        iconName = "keyboard";
        const textVal = action.text || "";
        captionText = `Typing "${textVal.length > 25 ? textVal.slice(0, 22) + "..." : textVal}"`;
        cursorMode = "typing";
        this.boxElement?.classList.add("type-mode");
        break;
      case "browser_keypress":
        iconName = "keyboard_alt";
        captionText = `Pressing [${action.key || "Key"}]`;
        cursorMode = "typing";
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

      // Move animated agent cursor to the target
      this.updateAgentCursor(targetBox.centerX, targetBox.centerY, cursorMode, captionText);

      if (action.type === "browser_click") {
        this.triggerClickShockwave(targetBox.centerX, targetBox.centerY);
      } else if (action.type === "browser_type") {
        this.showTypingHud(targetBox.x, targetBox.y - 40, action.text || "");
      }
    }

    this.clearTimer = setTimeout(() => this.clear(), 2400);
  }

  public handleVisualAction(detail: {
    type: "click" | "type" | "hover" | "move" | "keypress" | "scroll" | "download";
    x: number;
    y: number;
    rect?: { left: number; top: number; width: number; height: number };
    label?: string;
    text?: string;
    key?: string;
    direction?: string;
    amount?: number;
  }): void {
    if (!this.shadow) this.init();
    if (this.clearTimer) clearTimeout(this.clearTimer);

    const { type, x, y, rect, label, text } = detail;

    // Reset modifier classes
    this.boxElement?.classList.remove("type-mode", "hover-mode", "verified", "failed");
    this.captionElement?.classList.remove("verified", "failed");

    // Position target box if element rect provided
    if (rect && this.boxElement) {
      this.boxElement.style.display = "block";
      this.boxElement.style.left = `${Math.max(0, rect.left - 2)}px`;
      this.boxElement.style.top = `${Math.max(0, rect.top - 2)}px`;
      this.boxElement.style.width = `${rect.width + 4}px`;
      this.boxElement.style.height = `${rect.height + 4}px`;
    }

    if (type === "click") {
      this.updateAgentCursor(x, y, "clicking", `Clicked: ${label || "Button"}`);
      this.triggerClickShockwave(x, y);

      if (this.captionElement && rect) {
        this.captionElement.style.display = "flex";
        this.captionElement.style.left = `${Math.max(4, rect.left)}px`;
        this.captionElement.style.top = `${Math.max(20, rect.top)}px`;
        this.captionElement.innerHTML = `${getMaterial3Svg("touch_app", 14)} <span>Clicked: ${label || "Element"}</span>`;
      }
    } else if (type === "type") {
      this.boxElement?.classList.add("type-mode");
      this.updateAgentCursor(x, y, "typing", `Typing`);
      if (rect) {
        this.showTypingHud(rect.left, rect.top - 44, text || "");
      }
    } else if (type === "hover") {
      this.boxElement?.classList.add("hover-mode");
      this.updateAgentCursor(x, y, "hovering", `Hovering: ${label || "Element"}`);

      if (this.captionElement && rect) {
        this.captionElement.style.display = "flex";
        this.captionElement.style.left = `${Math.max(4, rect.left)}px`;
        this.captionElement.style.top = `${Math.max(20, rect.top)}px`;
        this.captionElement.innerHTML = `${getMaterial3Svg("visibility", 14)} <span>Hovering: ${label || "Element"}</span>`;
      }
    } else if (type === "keypress") {
      this.updateAgentCursor(x, y, "typing", `Key`);
      this.showKeypressHud(x, y, detail.key || "Enter");
    } else if (type === "scroll") {
      this.showScrollMarker(detail.direction || "down", detail.amount || 450);
    } else if (type === "download") {
      this.showDownloadHud(label || text || "Downloading file...");
    } else {
      this.updateAgentCursor(x, y, "default", label || "Agent Pointer");
    }

    this.clearTimer = setTimeout(() => this.clear(), 2400);
  }

  public updateAgentCursor(
    x: number,
    y: number,
    mode: "default" | "clicking" | "typing" | "hovering",
    label?: string
  ): void {
    if (!this.agentCursor) return;

    const dx = x - this.currentCursorX;
    const dy = y - this.currentCursorY;
    if (Math.sqrt(dx * dx + dy * dy) > 20) {
      this.dropMotionParticle(this.currentCursorX, this.currentCursorY);
    }

    const tilt = Math.abs(dx) > 3 ? Math.max(-14, Math.min(14, dx * 0.35)) : 0;
    this.currentCursorX = x;
    this.currentCursorY = y;

    this.agentCursor.style.display = "block";
    this.agentCursor.style.opacity = "1";
    this.agentCursor.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg)`;

    this.agentCursor.classList.remove("clicking");
    const badge = this.agentCursor.querySelector(".cursor-badge") as HTMLElement | null;
    if (badge) {
      badge.classList.remove("typing", "hovering", "verified");
    }

    if (mode === "clicking") {
      this.agentCursor.classList.add("clicking");
      if (this.cursorBadgeText) this.cursorBadgeText.textContent = label || "Click";
    } else if (mode === "typing") {
      badge?.classList.add("typing");
      if (this.cursorBadgeText) this.cursorBadgeText.textContent = label || "Typing";
    } else if (mode === "hovering") {
      badge?.classList.add("hovering");
      if (this.cursorBadgeText) this.cursorBadgeText.textContent = label || "Hover";
    } else {
      if (this.cursorBadgeText) this.cursorBadgeText.textContent = label || "Agent";
    }
  }

  public showKeypressHud(x: number, y: number, key: string): void {
    if (!this.keypressHudElement) return;
    const keySymbol = this.getKeySymbol(key);
    this.keypressHudElement.style.display = "flex";
    this.keypressHudElement.style.left = `${Math.max(30, Math.min(window.innerWidth - 180, x))}px`;
    this.keypressHudElement.style.top = `${Math.max(30, y - 48)}px`;
    this.keypressHudElement.innerHTML = `
      <span>Key:</span>
      <span class="keypress-keycap">${keySymbol}</span>
    `;
    setTimeout(() => {
      if (this.keypressHudElement) this.keypressHudElement.style.display = "none";
    }, 1500);
  }

  public showDownloadHud(title: string): void {
    if (!this.downloadHudElement) return;
    this.downloadHudElement.style.display = "flex";
    this.downloadHudElement.innerHTML = `
      <span class="download-spinner">⬇️</span>
      <span>${title}</span>
    `;
    setTimeout(() => {
      if (this.downloadHudElement) this.downloadHudElement.style.display = "none";
    }, 3200);
  }

  private getKeySymbol(key: string): string {
    const k = key.toLowerCase();
    if (k === "enter" || k === "return") return "↵ Enter";
    if (k === "escape" || k === "esc") return "⎋ Esc";
    if (k === "tab") return "⇥ Tab";
    if (k === "backspace") return "⌫ Backspace";
    if (k === "arrowdown" || k === "down") return "↓ Down";
    if (k === "arrowup" || k === "up") return "↑ Up";
    if (k === "arrowleft" || k === "left") return "← Left";
    if (k === "arrowright" || k === "right") return "→ Right";
    if (k === "space") return "␣ Space";
    return key;
  }

  private dropMotionParticle(x: number, y: number): void {
    if (!this.shadow || x <= 0 || y <= 0) return;
    const p = document.createElement("div");
    p.className = "cursor-particle";
    p.style.cssText = `position: fixed; left: ${x + 2}px; top: ${y + 2}px; width: 6px; height: 6px; border-radius: 50%; background: ${M3_COLORS.primary}; box-shadow: 0 0 10px ${M3_COLORS.primary}; pointer-events: none; z-index: 2147483646;`;
    this.shadow.appendChild(p);
    setTimeout(() => {
      try { p.remove(); } catch {}
    }, 450);
  }

  public triggerClickShockwave(x: number, y: number): void {
    if (!this.shockwaveElement) return;

    // Reset animation by cloning or replacing
    this.shockwaveElement.style.display = "block";
    this.shockwaveElement.style.left = `${x}px`;
    this.shockwaveElement.style.top = `${y}px`;

    const burst = this.shockwaveElement.querySelector(".shockwave-burst") as HTMLElement | null;
    const r1 = this.shockwaveElement.querySelector(".shockwave-ring-1") as HTMLElement | null;
    const r2 = this.shockwaveElement.querySelector(".shockwave-ring-2") as HTMLElement | null;

    if (burst && r1 && r2) {
      burst.style.animation = "none";
      r1.style.animation = "none";
      r2.style.animation = "none";
      // Trigger reflow
      void burst.offsetWidth;
      burst.style.animation = "burstFade 0.35s ease-out forwards";
      r1.style.animation = "shockwaveExpand1 0.5s cubic-bezier(0.1, 0.9, 0.2, 1) forwards";
      r2.style.animation = "shockwaveExpand2 0.65s 0.08s cubic-bezier(0.1, 0.9, 0.2, 1) forwards";
    }

    setTimeout(() => {
      if (this.shockwaveElement) this.shockwaveElement.style.display = "none";
    }, 750);
  }

  public showTypingHud(x: number, y: number, text: string): void {
    if (!this.typingHudElement) return;

    this.typingHudElement.style.display = "flex";
    this.typingHudElement.style.left = `${Math.max(12, x)}px`;
    this.typingHudElement.style.top = `${Math.max(12, y)}px`;

    if (this.typingHudText) {
      this.typingHudText.textContent = text ? `Typing: "${text}"` : "Typing text...";
    }
    if (this.typingHudCount) {
      this.typingHudCount.textContent = `${text.length} chars`;
    }
  }

  public showActionOutcome(success: boolean, message?: string): void {
    if (!this.boxElement || !this.captionElement) return;

    const badge = this.agentCursor?.querySelector(".cursor-badge") as HTMLElement | null;

    if (success) {
      this.boxElement.classList.add("verified");
      this.captionElement.classList.add("verified");
      this.captionElement.innerHTML = `${getMaterial3Svg("check_circle", 14)} <span>Verified ${message || ""}</span>`;
      badge?.classList.add("verified");
      if (this.cursorBadgeText) this.cursorBadgeText.textContent = "Verified";
    } else {
      this.boxElement.classList.add("failed");
      this.captionElement.classList.add("failed");
      this.captionElement.innerHTML = `${getMaterial3Svg("cancel", 14)} <span>Failed: ${message || "Action not confirmed"}</span>`;
    }

    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clear(), 1600);
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
    if (this.shockwaveElement) this.shockwaveElement.style.display = "none";
    if (this.typingHudElement) this.typingHudElement.style.display = "none";
    if (this.agentCursor) {
      this.agentCursor.style.opacity = "0";
      setTimeout(() => {
        if (this.agentCursor) this.agentCursor.style.display = "none";
      }, 200);
    }
    if (this.topProgressBar) this.topProgressBar.style.display = "none";
    if (this.edgeScrollMarker) this.edgeScrollMarker.style.display = "none";
    if (this.floatingToast) this.floatingToast.style.display = "none";
  }
}
