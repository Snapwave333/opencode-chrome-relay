import { NativeBridgePort } from "./native_port.js";
import { TabManager } from "./tab_manager.js";
import { CDPController } from "./cdp_controller.js";
import { ProtocolEnvelope, ActionPayload } from "@opencode/chrome-relay-protocol";

declare const __NVIDIA_API_KEY__: string | undefined;

const nativePort = new NativeBridgePort();
const tabManager = new TabManager();
const cdp = new CDPController();

// Connect to native host upon service worker startup
nativePort.connect();

// Enable 1-click access to open side panel when extension toolbar icon is clicked
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("Could not set openPanelOnActionClick:", err));
}

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && tab.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  }
});

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

      case "browser_download":
        if (action.url) {
          const downloadId = await new Promise<number>((resolve, reject) => {
            chrome.downloads.download(
              {
                url: action.url!,
                filename: action.download_path,
                saveAs: false,
              },
              (id) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(id);
                }
              }
            );
          });
          outcome = { success: true, verified: true, download_id: downloadId, url: action.url };
        } else {
          sendActionFailed(envelope, "Missing url for browser_download");
          return;
        }
        break;

      case "browser_upload":
        const uploadSelector = action.locator?.selector || 'input[type="file"]';
        const files = action.file_paths || [];
        if (files.length === 0) {
          sendActionFailed(envelope, "No file_paths specified for browser_upload");
          return;
        }
        const uploadSuccess = await cdp.setFileInputFiles(tabId, uploadSelector, files);
        outcome = { success: uploadSuccess, verified: uploadSuccess, uploaded_files: files };
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
  const tabId = envelope.tab_id || tabManager.getActiveTabId();
  if (tabId) {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: "OVERLAY_ACTION_OUTCOME",
        success: true,
        message: outcome?.outcome_summary || "Action verified",
      });
    } catch {
      // Content script may not be present
    }
  }

  const finishedEnvelope: ProtocolEnvelope = {
    v: 1,
    event: "action.finished",
    event_id: `evt_fin_${Date.now()}`,
    timestamp: new Date().toISOString(),
    run_id: envelope.run_id,
    epoch: envelope.epoch,
    sequence: envelope.sequence,
    idempotency_key: envelope.idempotency_key,
    action: envelope.action,
    payload: outcome,
  };

  try {
    chrome.runtime.sendMessage(finishedEnvelope);
  } catch {
    // Side panel might be closed
  }

  nativePort.send(finishedEnvelope);
}

function sendActionFailed(envelope: ProtocolEnvelope, error: string): void {
  const tabId = envelope.tab_id || tabManager.getActiveTabId();
  if (tabId) {
    try {
      chrome.tabs.sendMessage(tabId, {
        type: "OVERLAY_ACTION_OUTCOME",
        success: false,
        message: error,
      });
    } catch {
      // Content script may not be present
    }
  }

  const failedEnvelope: ProtocolEnvelope = {
    v: 1,
    event: "action.failed",
    event_id: `evt_err_${Date.now()}`,
    timestamp: new Date().toISOString(),
    run_id: envelope.run_id,
    epoch: envelope.epoch,
    sequence: envelope.sequence,
    idempotency_key: envelope.idempotency_key,
    action: envelope.action,
    payload: { error },
  };

  try {
    chrome.runtime.sendMessage(failedEnvelope);
  } catch {
    // Side panel might be closed
  }

  nativePort.send(failedEnvelope);
}

// Side panel communication
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_BRIDGE_STATUS") {
    sendResponse({ connected: nativePort.isConnected() });
  } else if (request.type === "ATTACH_ACTIVE_TAB") {
    if (request.tabId) {
      tabManager.attachTab(request.tabId).then((ok) => {
        sendResponse({ attached: ok, tabId: request.tabId });
      });
      return true;
    }
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
    if (request.command === "steer" && request.instruction) {
      void handleUserChat(
        request.run_id || "run_1",
        request.epoch || 0,
        request.instruction,
        request.history || []
      );
    }
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

const ACTIVE_NIM_MODELS = [
  "poolside/laguna-xs-2.1",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-super-120b-a12b",
];

async function getNvidiaApiKey(): Promise<string> {
  if (typeof __NVIDIA_API_KEY__ !== "undefined" && __NVIDIA_API_KEY__) {
    return __NVIDIA_API_KEY__;
  }
  try {
    const stored = await chrome.storage.local.get("nvidia_api_key");
    if (stored?.nvidia_api_key) return stored.nvidia_api_key;
  } catch {
    // Storage unavailable
  }
  return "";
}

async function handleUserChat(
  runId: string,
  epoch: number,
  userText: string,
  history: Array<{ role: string; text: string }>
): Promise<void> {
  try {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (res) => resolve(res || []));
    });
    const activeTab = tabs[0];
    const tabContext = activeTab
      ? `Active Chrome Tab: "${activeTab.title || "Untitled"}" (${activeTab.url || "about:blank"})`
      : "No active browser tab detected.";

    const apiKey = await getNvidiaApiKey();
    if (!apiKey) {
      broadcastChatResponse(
        runId,
        epoch,
        "Pong! Relay agent is online, but NVIDIA_API_KEY is not configured in the build or extension storage.",
        "local"
      );
      return;
    }

    const systemPrompt = [
      "You are the OpenCode Chrome Relay browser agent inside the Chrome Side Panel.",
      tabContext,
      "Keep replies concise, direct, and helpful without filler or boilerplate.",
      "If the user asks you to perform a browser action on the active tab (navigate, click, type, scroll), include a JSON block at the end of your reply in this exact format:",
      '```json\n{"action":{"type":"browser_navigate","url":"https://example.com"}}\n```',
      'Supported action types: "browser_navigate" (with "url"), "browser_click" (with "locator":{"selector":"...","name":"..."}), "browser_type" (with "locator":{"selector":"..."},"text":"..."), "browser_scroll" (with "scroll_direction":"down"|"up","scroll_amount":400).',
      "For normal chat or questions (like 'ping'), just reply in plain text without any JSON block.",
    ].join("\n");

    const priorMessages = history
      .slice(-8)
      .filter((m) => m.text && m.text !== "Thinking...")
      .map((m) => ({
        role: (m.role === "agent" ? "assistant" : "user") as "assistant" | "user",
        content: m.text,
      }));

    if (priorMessages.length === 0 || priorMessages[priorMessages.length - 1].content !== userText) {
      priorMessages.push({ role: "user", content: userText });
    }

    let replyText = "";
    let modelUsed = ACTIVE_NIM_MODELS[0];

    for (const model of ACTIVE_NIM_MODELS) {
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemPrompt }, ...priorMessages],
            temperature: 0.2,
            max_tokens: 400,
          }),
        });

        if (!res.ok) continue;
        const data: any = await res.json();
        const msg = data?.choices?.[0]?.message;
        const content = (msg?.content || msg?.reasoning_content || "").trim();
        if (content) {
          replyText = content;
          modelUsed = model;
          break;
        }
      } catch {
        // Try next model
      }
    }

    if (!replyText) {
      replyText = "Pong! Agent is connected, but NVIDIA NIM did not return a response.";
    }

    // Check if the model emitted a browser action block
    const jsonMatch = replyText.match(/```json\s*(\{[\s\S]*?\})\s*```/) || replyText.match(/(\{"action"\s*:\s*\{[\s\S]*?\}\})/);
    let parsedAction: ActionPayload | null = null;
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed?.action?.type) {
          parsedAction = parsed.action as ActionPayload;
          replyText = replyText.replace(jsonMatch[0], "").trim();
        }
      } catch {
        // Ignore malformed JSON block
      }
    }

    broadcastChatResponse(runId, epoch, replyText || `Executing ${parsedAction?.type}...`, modelUsed);

    if (parsedAction && activeTab?.id) {
      const actionEnvelope: ProtocolEnvelope = {
        v: 1,
        event: "action.started",
        event_id: `evt_act_${Date.now()}`,
        timestamp: new Date().toISOString(),
        run_id: runId,
        epoch,
        tab_id: activeTab.id,
        idempotency_key: `idem_${Date.now()}`,
        action: parsedAction,
      };
      try {
        chrome.runtime.sendMessage(actionEnvelope);
      } catch {
        // Sidepanel closed
      }
      await handleActionRequest(actionEnvelope);
    }
  } catch (err: any) {
    broadcastChatResponse(runId, epoch, `Error: ${err?.message || "Failed to contact agent"}`, "error");
  }
}

function broadcastChatResponse(runId: string, epoch: number, text: string, model: string): void {
  const envelope: ProtocolEnvelope = {
    v: 1,
    event: "chat.response",
    event_id: `evt_chat_${Date.now()}`,
    timestamp: new Date().toISOString(),
    run_id: runId,
    epoch,
    payload: {
      text,
      model,
    },
  };
  try {
    chrome.runtime.sendMessage(envelope);
  } catch {
    // Sidepanel closed
  }
}
