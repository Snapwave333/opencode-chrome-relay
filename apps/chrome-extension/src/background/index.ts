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

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

async function resolveActiveTab(preferredTabId?: number | null): Promise<chrome.tabs.Tab | null> {
  if (preferredTabId) {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t) return t;
    } catch {
      // Tab no longer exists
    }
  }
  const activeFromMgr = tabManager.getActiveTabId();
  if (activeFromMgr) {
    try {
      const t = await chrome.tabs.get(activeFromMgr);
      if (t) return t;
    } catch {
      // Tab closed
    }
  }
  const lastFocused = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (res) => resolve(res || []));
  });
  if (lastFocused[0]?.id) return lastFocused[0];

  const anyActive = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ active: true }, (res) => resolve(res || []));
  });
  return anyActive.find((t) => t.id && !t.url?.startsWith("devtools://")) || anyActive[0] || null;
}

async function waitForTabComplete(tabId: number, timeoutMs = 3500): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs);
  });
}

async function handleActionRequest(envelope: ProtocolEnvelope): Promise<void> {
  const action = envelope.action;
  if (!action) return;

  const resolvedTab = await resolveActiveTab(envelope.tab_id);
  let tabId = resolvedTab?.id;

  // Handle browser_navigate directly via chrome.tabs.update (or create) so it works from any tab including chrome://newtab/
  if (action.type === "browser_navigate") {
    if (!action.url) {
      sendActionFailed(envelope, "Missing URL for browser_navigate");
      return;
    }
    try {
      const targetUrl = normalizeUrl(action.url);
      if (tabId) {
        await chrome.tabs.update(tabId, { url: targetUrl, active: true });
        await waitForTabComplete(tabId);
      } else {
        const created = await chrome.tabs.create({ url: targetUrl, active: true });
        tabId = created.id;
        if (tabId) await waitForTabComplete(tabId);
      }
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        url: targetUrl,
        outcome_summary: `Navigated to ${targetUrl}`,
      });
    } catch (err: any) {
      sendActionFailed(envelope, err?.message || "Navigation failed");
    }
    return;
  }

  if (!tabId) {
    sendActionFailed(envelope, "No active browser tab found");
    return;
  }

  // Try attaching debugger for CDP actions; fall back to chrome.scripting if blocked
  let hasCdp = tabManager.isAttached(tabId);
  if (!hasCdp) {
    hasCdp = await tabManager.attachTab(tabId);
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
      case "browser_click":
        if (hasCdp) {
          if (action.locator?.point) {
            await cdp.click(tabId, action.locator.point.x, action.locator.point.y);
          } else {
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
        } else {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (loc: any) => {
              const el = loc?.selector
                ? document.querySelector(loc.selector)
                : Array.from(document.querySelectorAll("button, a, input, [role]")).find((e) =>
                    (e.getAttribute("aria-label") || e.textContent || "")
                      .toLowerCase()
                      .includes((loc?.name || "").toLowerCase())
                  );
              if (!el) return false;
              (el as HTMLElement).click();
              return true;
            },
            args: [action.locator || {}],
          });
          if (!res?.result) {
            sendActionFailed(envelope, `Element not found for locator: ${JSON.stringify(action.locator)}`);
            return;
          }
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_type":
        if (hasCdp) {
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
        } else {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (loc: any, text: string) => {
              const el = (loc?.selector
                ? document.querySelector(loc.selector)
                : document.activeElement || document.querySelector("input, textarea")) as HTMLInputElement | null;
              if (el) {
                el.focus();
                el.value = text;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }
            },
            args: [action.locator || {}, action.text || ""],
          });
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_keypress":
        if (hasCdp && action.key) {
          await cdp.keypress(tabId, action.key);
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_scroll":
        const dir = action.scroll_direction || "down";
        const amt = action.scroll_amount || 400;
        const deltaY = dir === "down" ? amt : dir === "up" ? -amt : 0;
        const deltaX = dir === "right" ? amt : dir === "left" ? -amt : 0;
        if (hasCdp) {
          await cdp.evaluate(tabId, `window.scrollBy(${deltaX}, ${deltaY})`);
        } else {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (dx: number, dy: number) => window.scrollBy(dx, dy),
            args: [deltaX, deltaY],
          });
        }
        outcome = { success: true, verified: true };
        break;

      case "browser_snapshot":
        const snapshot = hasCdp
          ? await cdp.evaluate(
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
            )
          : (
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => ({ title: document.title, url: window.location.href }),
              })
            )[0]?.result;
        outcome = { success: true, verified: true, snapshot };
        break;

      case "browser_screenshot":
        const screenshot = hasCdp ? await cdp.captureScreenshot(tabId) : "";
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
        const uploadSuccess = hasCdp ? await cdp.setFileInputFiles(tabId, uploadSelector, files) : false;
        outcome = { success: uploadSuccess, verified: uploadSuccess, uploaded_files: files };
        break;

      case "browser_verify":
        const verified = hasCdp
          ? await cdp.evaluate(
              tabId,
              `Boolean(${JSON.stringify(action.locator?.selector)} ? document.querySelector(${JSON.stringify(action.locator?.selector)}) : document.body.innerText.includes(${JSON.stringify(action.text || "")}))`
            )
          : Boolean(
              (
                await chrome.scripting.executeScript({
                  target: { tabId },
                  func: (sel: string | undefined, txt: string) =>
                    Boolean(sel ? document.querySelector(sel) : document.body.innerText.includes(txt)),
                  args: [action.locator?.selector, action.text || ""],
                })
              )[0]?.result
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
        request.history || [],
        request.tab_id
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

function extractBalancedJsonObjects(text: string): Array<{ raw: string; parsed: any }> {
  const results: Array<{ raw: string; parsed: any }> = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(i, j + 1);
            try {
              const parsed = JSON.parse(candidate);
              results.push({ raw: candidate, parsed });
              i = j;
            } catch {
              // Not valid JSON
            }
            break;
          }
        }
      }
    }
  }
  return results;
}

function inferActionFromUserIntent(userText: string): ActionPayload | null {
  const trimmed = userText.trim();

  // Direct URL or domain (e.g. "https://example.com" or "google.com")
  if (/^https?:\/\/[^\s]+$/i.test(trimmed) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(trimmed)) {
    return { type: "browser_navigate", url: normalizeUrl(trimmed) } as ActionPayload;
  }

  // Natural language navigation: "navigate to X", "go to X", "open X", "visit X"
  const navMatch = trimmed.match(
    /^(?:please\s+|can\s+you\s+)?(?:navigate|navagate|go|open|visit|browse|head)\s+(?:to\s+)?([^\s,]+)$/i
  );
  if (navMatch && navMatch[1]) {
    let target = navMatch[1].replace(/[?.!]+$/, "");
    if (!/^https?:\/\//i.test(target) && !target.includes(".")) {
      target = `https://www.${target.toLowerCase()}.com`;
    } else {
      target = normalizeUrl(target);
    }
    return { type: "browser_navigate", url: target } as ActionPayload;
  }

  // Natural language search: "search for X" or "search google for X"
  const searchMatch = trimmed.match(/^(?:please\s+)?search\s+(?:google\s+)?(?:for\s+)?(.+)$/i);
  if (searchMatch && searchMatch[1]) {
    const query = searchMatch[1].trim();
    return {
      type: "browser_navigate",
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    } as ActionPayload;
  }

  // Natural language scroll: "scroll down", "scroll up"
  const scrollMatch = trimmed.match(/^(?:please\s+)?scroll\s+(down|up|left|right)(?:\s+(\d+))?/i);
  if (scrollMatch && scrollMatch[1]) {
    return {
      type: "browser_scroll",
      scroll_direction: scrollMatch[1].toLowerCase() as "down" | "up" | "left" | "right",
      scroll_amount: scrollMatch[2] ? parseInt(scrollMatch[2], 10) : 450,
    } as ActionPayload;
  }

  return null;
}

function extractActionAndCleanReply(
  replyText: string,
  userText: string
): { cleanReply: string; action: ActionPayload | null } {
  let cleanReply = replyText;
  let action: ActionPayload | null = null;

  // 1. Check fenced code blocks first
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(replyText)) !== null) {
    const objs = extractBalancedJsonObjects(match[1]);
    for (const obj of objs) {
      const candidate = obj.parsed?.action || obj.parsed;
      if (candidate && typeof candidate.type === "string") {
        action = candidate as ActionPayload;
        cleanReply = cleanReply.replace(match[0], "").trim();
        break;
      }
    }
    if (action) break;
  }

  // 2. If not in fenced block, check inline balanced JSON objects
  if (!action) {
    const objs = extractBalancedJsonObjects(replyText);
    for (const obj of objs) {
      const candidate = obj.parsed?.action || obj.parsed;
      if (candidate && typeof candidate.type === "string") {
        action = candidate as ActionPayload;
        cleanReply = cleanReply.replace(obj.raw, "").trim();
        break;
      }
    }
  }

  // 3. Normalize action type aliases if LLM emitted "navigate" instead of "browser_navigate"
  if (action && !action.type.startsWith("browser_")) {
    action = { ...action, type: `browser_${action.type}` as any };
  }

  // 4. Deterministic fallback if user explicitly asked to navigate/search/scroll
  if (!action) {
    action = inferActionFromUserIntent(userText);
  }

  return { cleanReply, action };
}

async function handleUserChat(
  runId: string,
  epoch: number,
  userText: string,
  history: Array<{ role: string; text: string }>,
  preferredTabId?: number | null
): Promise<void> {
  try {
    const activeTab = await resolveActiveTab(preferredTabId);
    const tabContext = activeTab
      ? `Active Chrome Tab: "${activeTab.title || "Untitled"}" (${activeTab.url || "about:blank"})`
      : "No active browser tab detected.";

    const apiKey = await getNvidiaApiKey();
    if (!apiKey) {
      const fallbackAction = inferActionFromUserIntent(userText);
      if (fallbackAction) {
        broadcastChatResponse(runId, epoch, `Executing ${fallbackAction.type}...`, "local");
        await dispatchBrowserAction(runId, epoch, activeTab?.id, fallbackAction);
        return;
      }
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
      "Whenever the user asks to navigate, open a website, search, click, type, or scroll, you MUST include a JSON block at the end of your reply in this exact format:",
      '```json\n{"action":{"type":"browser_navigate","url":"https://example.com"}}\n```',
      'Supported action types: "browser_navigate" (with "url"), "browser_click" (with "locator":{"selector":"...","name":"..."}), "browser_type" (with "locator":{"selector":"..."},"text":"..."), "browser_scroll" (with "scroll_direction":"down"|"up","scroll_amount":400).',
      "For normal chat or questions (like 'ping'), reply in plain text without any JSON block.",
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

    const { cleanReply, action: parsedAction } = extractActionAndCleanReply(replyText, userText);

    const displayMessage =
      cleanReply ||
      (parsedAction?.type === "browser_navigate"
        ? `Navigating to ${parsedAction.url}...`
        : parsedAction
          ? `Executing ${parsedAction.type}...`
          : "Pong! Agent is ready.");

    broadcastChatResponse(runId, epoch, displayMessage, modelUsed);

    if (parsedAction) {
      await dispatchBrowserAction(runId, epoch, activeTab?.id, parsedAction);
    }
  } catch (err: any) {
    broadcastChatResponse(runId, epoch, `Error: ${err?.message || "Failed to contact agent"}`, "error");
  }
}

async function dispatchBrowserAction(
  runId: string,
  epoch: number,
  tabId: number | undefined,
  action: ActionPayload
): Promise<void> {
  const actionEnvelope: ProtocolEnvelope = {
    v: 1,
    event: "action.started",
    event_id: `evt_act_${Date.now()}`,
    timestamp: new Date().toISOString(),
    run_id: runId,
    epoch,
    tab_id: tabId,
    idempotency_key: `idem_${Date.now()}`,
    action,
  };
  try {
    chrome.runtime.sendMessage(actionEnvelope);
  } catch {
    // Sidepanel closed
  }
  await handleActionRequest(actionEnvelope);
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
