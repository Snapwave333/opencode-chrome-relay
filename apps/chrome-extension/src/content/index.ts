import { ActionOverlay } from "./overlay.js";
import { InPageDock } from "./dock.js";

const overlay = new ActionOverlay();
const dock = new InPageDock();

overlay.init();

// Listen to messages from background worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OVERLAY_ACTION_PREVIEW" && msg.action) {
    overlay.showActionPreview(msg.action);
  } else if (msg.type === "SHOW_IN_PAGE_DOCK") {
    dock.init((command) => {
      chrome.runtime.sendMessage({ type: "DISPATCH_CONTROL", command });
    });
  } else if (msg.type === "CLEAR_OVERLAY") {
    overlay.clear();
  }
});
