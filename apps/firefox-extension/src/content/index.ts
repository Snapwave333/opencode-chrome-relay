import { ActionOverlay } from "./overlay.js";
import { InPageDock } from "./dock.js";

const overlay = new ActionOverlay();
const dock = new InPageDock();

overlay.init();

function pingBackgroundWorker(): void {
  try {
    chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, () => {
      const _ignore = chrome.runtime.lastError;
    });
  } catch {
    // Extension context invalidated or reloading
  }
}

pingBackgroundWorker();
setInterval(pingBackgroundWorker, 15000);

// Listen to messages from background worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OVERLAY_ACTION_PREVIEW" && msg.action) {
    overlay.showActionPreview(msg.action);
  } else if (msg.type === "OVERLAY_ACTION_OUTCOME") {
    overlay.showActionOutcome(msg.success, msg.message);
  } else if (msg.type === "SHOW_IN_PAGE_DOCK") {
    dock.init((command) => {
      chrome.runtime.sendMessage({ type: "DISPATCH_CONTROL", command });
    });
  } else if (msg.type === "CLEAR_OVERLAY") {
    overlay.clear();
  }
});

// Listen to visual action events dispatched during DOM action executions
window.addEventListener("OPENCODE_RELAY_VISUAL_ACTION", (ev: any) => {
  if (ev?.detail) {
    overlay.handleVisualAction(ev.detail);
  }
});
