import { NativeBridgePort } from "./native_port.js";
import { TabManager } from "./tab_manager.js";
import { CDPController } from "./cdp_controller.js";
import { ProtocolEnvelope, ActionPayload } from "@opencode/chrome-relay-protocol";

const nativePort = new NativeBridgePort();
const tabManager = new TabManager();
const cdp = new CDPController();

// Connect to native host upon service worker startup
nativePort.connect();

nativePort.onMessage(async (msg: ProtocolEnvelope) => {
  // Broadcast to sidepanel and open extension views
  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // Side panel might be closed
  }

  if (msg.event === "action.started" && msg.action) {
    await handleActionRequest(msg);
  }
});

async function handleActionRequest(envelope: ProtocolEnvelope): Promise<void> {
  const action = envelope.action;
  if (!action) return;

  const tabId = envelope.tab_id || tabManager.getActiveTabId();
  if (!tabId) {
    sendActionFailed(envelope, "No active or authorized tab attached");
    return;
  }

  // Ensure debugger attached
  if (!tabManager.isAttached(tabId)) {
    const attached = await tabManager.attachTab(tabId);
    if (!attached) {
      sendActionFailed(envelope, `Could not attach debugger to tab ${tabId}`);
      return;
    }
  }

  // Notify overlay about action preview
  try {
    chrome.tabs.sendMessage(tabId, {
      type: "OVERLAY_ACTION_PREVIEW",
      action,
    });
  } catch {
    // Content script may not be loaded yet on some tabs
  }

  try {
    let outcome: any = { success: true, verified: true };

    switch (action.type) {
      case "browser_navigate":
        if (action.url) {
          await cdp.navigate(tabId, action.url);
          outcome = { success: true, verified: true, url: action.url };
        }
        break;

      case "browser_click":
        if (action.locator?.point) {
          await cdp.click(tabId, action.locator.point.x, action.locator.point.y);
        } else {
          // Resolve locator in page
          const resolved = await cdp.evaluate(
            tabId,
            `(${resolveInPage})(${JSON.stringify(action.locator || {})})`
          );
          if (!resolved || !resolved.found) {
            sendActionFailed(envelope, `Element not found for locator: ${JSON.stringify(action.locator)}`);
            return;
          }
          await cdp.click(tabId, resolved.box.centerX, resolved.box.centerY);
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_type":
        if (action.locator) {
          const resolved = await cdp.evaluate(
            tabId,
            `(${resolveInPage})(${JSON.stringify(action.locator)})`
          );
          if (resolved?.found) {
            await cdp.click(tabId, resolved.box.centerX, resolved.box.centerY);
          }
        }
        if (action.text) {
          await cdp.type(tabId, action.text);
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_keypress":
        if (action.key) {
          await cdp.keypress(tabId, action.key);
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_scroll":
        const dir = action.scroll_direction || "down";
        const amt = action.scroll_amount || 400;
        const deltaY = dir === "down" ? amt : dir === "up" ? -amt : 0;
        const deltaX = dir === "right" ? amt : dir === "left" ? -amt : 0;
        await cdp.evaluate(tabId, `window.scrollBy(${deltaX}, ${deltaY})`);
        outcome = { success: true, verified: true };
        break;

      case "browser_snapshot":
        const snapshot = await cdp.evaluate(
          tabId,
          `({
            title: document.title,
            url: window.location.href,
            elements: Array.from(document.querySelectorAll("button, a, input, select, [role]")).map(e => ({
              tag: e.tagName.toLowerCase(),
              role: e.getAttribute("role") || e.tagName.toLowerCase(),
              name: e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 50),
              type: (e as HTMLInputElement).type || null,
              disabled: (e as HTMLButtonElement).disabled || false
            }))
          })`
        );
        outcome = { success: true, verified: true, snapshot };
        break;

      case "browser_screenshot":
        const screenshot = await cdp.captureScreenshot(tabId);
        outcome = { success: true, verified: true, screenshot_base64: screenshot };
        break;

      case "browser_verify":
        const verified = await cdp.evaluate(
          tabId,
          `Boolean(${JSON.stringify(action.locator?.selector)} ? document.querySelector(${JSON.stringify(action.locator?.selector)}) : document.body.innerText.includes(${JSON.stringify(action.text || "")}))`
        );
        outcome = { success: verified, verified };
        break;

      default:
        outcome = { success: true, verified: true };
    }

    sendActionFinished(envelope, outcome);
  } catch (err: any) {
    sendActionFailed(envelope, err.message || "Action failed");
  }
}

function resolveInPage(locator: any): any {
  if (locator.selector) {
    const el = document.querySelector(locator.selector);
    if (el) {
      const r = el.getBoundingClientRect();
      return { found: true, box: { centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 } };
    }
  }
  const elements = Array.from(document.querySelectorAll("button, a, input, [role]"));
  for (const el of elements) {
    const name = el.getAttribute("aria-label") || el.textContent || "";
    if (locator.name && name.toLowerCase().includes(locator.name.toLowerCase())) {
      const r = el.getBoundingClientRect();
      return { found: true, box: { centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 } };
    }
  }
  return { found: false };
}

function sendActionFinished(envelope: ProtocolEnvelope, outcome: any): void {
  nativePort.send({
    v: 1,
    event: "action.finished",
    event_id: `evt_fin_${Date.now()}`,
    run_id: envelope.run_id,
    epoch: envelope.epoch,
    sequence: envelope.sequence,
    idempotency_key: envelope.idempotency_key,
    payload: outcome,
  });
}

function sendActionFailed(envelope: ProtocolEnvelope, error: string): void {
  nativePort.send({
    v: 1,
    event: "action.failed",
    event_id: `evt_err_${Date.now()}`,
    run_id: envelope.run_id,
    epoch: envelope.epoch,
    sequence: envelope.sequence,
    idempotency_key: envelope.idempotency_key,
    payload: { error },
  });
}

// Side panel communication
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_BRIDGE_STATUS") {
    sendResponse({ connected: nativePort.isConnected() });
  } else if (request.type === "ATTACH_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        const ok = await tabManager.attachTab(tab.id);
        sendResponse({ attached: ok, tabId: tab.id });
      } else {
        sendResponse({ attached: false });
      }
    });
    return true;
  } else if (request.type === "DISPATCH_CONTROL") {
    nativePort.send({
      command: request.command,
      run_id: request.run_id,
      epoch: request.epoch,
      instruction: request.instruction,
    });
    sendResponse({ success: true });
  } else if (request.type === "SESSION_COMMAND") {
    nativePort.send({
      v: 1,
      event: request.event,
      event_id: `evt_sess_${Date.now()}`,
      run_id: request.run_id,
      payload: request.payload,
    });
    sendResponse({ success: true });
  }
});
