import { NativeBridgePort } from "./native_port.js";
import { TabManager } from "./tab_manager.js";
import { CDPController } from "./cdp_controller.js";
import { ProtocolEnvelope, ActionPayload } from "@opencode/chrome-relay-protocol";

declare const __NVIDIA_API_KEY__: string | undefined;

const nativePort = new NativeBridgePort();
const tabManager = new TabManager();
const cdp = new CDPController();
cdp.setOnDetachHandler((tabId) => tabManager.markDetached(tabId));

// Connect to native host upon service worker startup
nativePort.connect();

if (chrome.tabs) {
  chrome.tabs.onCreated?.addListener(() => nativePort.connect());
  chrome.tabs.onUpdated?.addListener(() => nativePort.connect());
  chrome.tabs.onActivated?.addListener(() => nativePort.connect());
}

// Suppress and auto-accept native Save As file dialogs for seamless agent downloads
if (typeof chrome !== "undefined" && chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    suggest({
      filename: item.filename,
      conflictAction: "uniquify",
    });
    return true;
  });
}

// Auto-handle JavaScript alert/confirm/prompt dialogs via CDP so tab threads don't block
if (typeof chrome !== "undefined" && chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener(async (source, method) => {
    if (method === "Page.javascriptDialogOpening" && source.tabId) {
      try {
        await chrome.debugger.sendCommand(source, "Page.handleJavaScriptDialog", {
          accept: true,
          promptText: "",
        });
      } catch {}
    }
  });
}

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

const handledIdempotencyKeys = new Set<string>();

nativePort.onMessage(async (msg: ProtocolEnvelope) => {
  if ((msg.event as string) === "extension.reload") {
    chrome.runtime.reload();
    return;
  }
  if ((msg.payload as any)?.from_extension) {
    return;
  }

  // Broadcast to sidepanel and open extension views
  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // Side panel might be closed
  }

  if (msg.event === "action.started" && msg.action) {
    if (msg.idempotency_key) {
      if (handledIdempotencyKeys.has(msg.idempotency_key)) {
        return;
      }
      handledIdempotencyKeys.add(msg.idempotency_key);
      if (handledIdempotencyKeys.size > 500) {
        const first = handledIdempotencyKeys.values().next().value;
        if (first) handledIdempotencyKeys.delete(first);
      }
    }
    await handleActionRequest(msg);
  } else if (
    msg.event === "run.state_changed" &&
    (msg.payload as any)?.command === "steer" &&
    typeof (msg.payload as any)?.instruction === "string"
  ) {
    const runId = msg.run_id || "run_1";
    if (!activeRuns.has(runId)) {
      void handleUserChat(
        runId,
        msg.epoch || 0,
        (msg.payload as any).instruction,
        [],
        msg.tab_id
      );
    }
  }
});

const KNOWN_SITES: Array<{ pattern: RegExp; url: string }> = [
  {
    pattern: /\b(oauth|credentials?|client\s+secret|client\s+id|api\s+keys?|admin\s+privileges?|scopes?)\b/i,
    url: "https://console.cloud.google.com/apis/credentials",
  },
  {
    pattern: /\b(create\s+oauth|new\s+oauth\s+client)\b/i,
    url: "https://console.cloud.google.com/apis/credentials/oauthclient",
  },
  {
    pattern: /\b(google\s+cloud(\s+console|\s+consuil|\s+platform)?|gcp(\s+console)?)\b/i,
    url: "https://console.cloud.google.com",
  },
  { pattern: /\b(gmail|google\s+mail)\b/i, url: "https://mail.google.com" },
  { pattern: /\b(google\s+drive|gdrive)\b/i, url: "https://drive.google.com" },
  { pattern: /\b(google\s+docs)\b/i, url: "https://docs.google.com" },
  { pattern: /\b(google\s+sheets)\b/i, url: "https://sheets.google.com" },
  { pattern: /\b(google\s+calendar|gcal)\b/i, url: "https://calendar.google.com" },
  { pattern: /\b(google\s+maps)\b/i, url: "https://maps.google.com" },
  { pattern: /\b(youtube\s+studio|yt\s+studio)\b/i, url: "https://studio.youtube.com" },
  { pattern: /\b(youtube|yt)\b/i, url: "https://www.youtube.com" },
  { pattern: /\b(github)\b/i, url: "https://github.com" },
  { pattern: /\b(gitlab)\b/i, url: "https://gitlab.com" },
  { pattern: /\b(aws(\s+console|\s+management\s+console)?)\b/i, url: "https://console.aws.amazon.com" },
  { pattern: /\b(azure(\s+portal)?)\b/i, url: "https://portal.azure.com" },
  { pattern: /\b(cloudflare(\s+dashboard|\s+console)?)\b/i, url: "https://dash.cloudflare.com" },
  { pattern: /\b(vercel(\s+dashboard)?)\b/i, url: "https://vercel.com/dashboard" },
  { pattern: /\b(netlify)\b/i, url: "https://app.netlify.com" },
  { pattern: /\b(supabase(\s+dashboard)?)\b/i, url: "https://supabase.com/dashboard" },
  { pattern: /\b(openai(\s+platform)?)\b/i, url: "https://platform.openai.com" },
  { pattern: /\b(chatgpt)\b/i, url: "https://chatgpt.com" },
  { pattern: /\b(claude)\b/i, url: "https://claude.ai" },
  { pattern: /\b(nvidia\s+nim|build\s+nvidia)\b/i, url: "https://build.nvidia.com" },
  { pattern: /\b(hacker\s*news|hn)\b/i, url: "https://news.ycombinator.com" },
  { pattern: /\b(reddit)\b/i, url: "https://www.reddit.com" },
  { pattern: /\b(twitter|x\.com)\b/i, url: "https://x.com" },
  { pattern: /\b(linkedin)\b/i, url: "https://www.linkedin.com" },
  { pattern: /\b(stack\s*overflow)\b/i, url: "https://stackoverflow.com" },
  { pattern: /\b(google)\b/i, url: "https://www.google.com" },
];

function normalizeUrl(rawUrl: string): string {
  const cleaned = rawUrl
    .trim()
    .replace(/\s+dot\s+(com|org|net|io|ai|dev|edu|gov|co)\b/gi, ".$1")
    .replace(/[?.!,;]+$/, "")
    .trim();

  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(cleaned) || /^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(cleaned)) {
    return `http://${cleaned}`;
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }

  for (const entry of KNOWN_SITES) {
    if (entry.pattern.test(cleaned)) {
      return entry.url;
    }
  }

  const stripped = cleaned.replace(/^(?:my|the|our)\s+/i, "").trim();
  if (/^[a-z0-9-]+$/i.test(stripped)) {
    return `https://www.${stripped.toLowerCase()}.com`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(stripped || cleaned)}`;
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

async function waitForTabComplete(tabId: number, timeoutMs = 4500): Promise<void> {
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

async function handleActionRequest(
  envelope: ProtocolEnvelope
): Promise<{ success: boolean; summary: string; tabId?: number }> {
  const action = envelope.action;
  if (!action) return { success: false, summary: "Missing action" };

  if (action.type === "browser_list_tabs") {
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      active: t.active,
      title: t.title || "",
      url: t.url || "",
    }));
    const summary = `Listed ${tabs.length} open browser tabs`;
    sendActionFinished(envelope, {
      success: true,
      verified: true,
      tabs,
      outcome_summary: summary,
    });
    return { success: true, summary };
  }

  if (action.type === "browser_new_tab") {
    try {
      const targetUrl = action.url ? normalizeUrl(action.url) : "https://www.google.com";
      const created = await chrome.tabs.create({ url: targetUrl, active: true });
      if (created.id) await waitForTabComplete(created.id);
      const summary = `Opened new tab (${created.id}) at ${targetUrl}`;
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        tab_id: created.id,
        url: targetUrl,
        outcome_summary: summary,
      });
      return { success: true, summary, tabId: created.id };
    } catch (err: any) {
      const msg = err?.message || "Failed to create new tab";
      sendActionFailed(envelope, msg);
      return { success: false, summary: msg };
    }
  }

  const resolvedTab = await resolveActiveTab(envelope.tab_id);
  let tabId = resolvedTab?.id;

  if (action.type === "browser_status") {
    const summary = nativePort.isConnected() ? "Relay bridge connected" : "Relay bridge reconnecting";
    sendActionFinished(envelope, {
      success: true,
      verified: true,
      bridge_connected: nativePort.isConnected(),
      active_tab_id: tabId,
      tab_attached: tabId ? tabManager.isAttached(tabId) : false,
      outcome_summary: summary,
    });
    return { success: true, summary, tabId };
  }

  if (action.type === "browser_attach") {
    if (!tabId) {
      sendActionFailed(envelope, "No browser tab found to attach");
      return { success: false, summary: "No browser tab found to attach" };
    }
    const attached = await tabManager.attachTab(tabId);
    const summary = attached ? `Attached tab ${tabId}` : `Could not attach tab ${tabId}`;
    if (attached) {
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        tab_id: tabId,
        outcome_summary: summary,
      });
    } else {
      sendActionFailed(envelope, summary);
    }
    return { success: attached, summary, tabId };
  }

  if (action.type === "browser_detach") {
    if (!tabId) {
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        outcome_summary: "No tab was attached",
      });
      return { success: true, summary: "No tab was attached" };
    }
    const detached = await tabManager.detachTab(tabId);
    const summary = detached ? `Detached tab ${tabId}` : `Could not detach tab ${tabId}`;
    if (detached) {
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        tab_id: tabId,
        outcome_summary: summary,
      });
    } else {
      sendActionFailed(envelope, summary);
    }
    return { success: detached, summary, tabId };
  }

  if (action.type === "browser_close_tab") {
    if (!tabId) {
      sendActionFailed(envelope, "No tab ID found to close");
      return { success: false, summary: "No tab ID found to close" };
    }
    try {
      await chrome.tabs.remove(tabId);
      const summary = `Closed tab ${tabId}`;
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        closed_tab_id: tabId,
        outcome_summary: summary,
      });
      return { success: true, summary };
    } catch (err: any) {
      const msg = err?.message || "Failed to close tab";
      sendActionFailed(envelope, msg);
      return { success: false, summary: msg };
    }
  }

  if (action.type === "browser_switch_tab") {
    const targetTabId = envelope.tab_id || (action.value ? parseInt(action.value, 10) : undefined);
    if (!targetTabId) {
      sendActionFailed(envelope, "No target tab ID provided to switch to");
      return { success: false, summary: "No target tab ID provided" };
    }
    try {
      const tab = await chrome.tabs.update(targetTabId, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      const summary = `Switched to tab ${targetTabId} (${tab.title || tab.url || "Untitled"})`;
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        tab_id: targetTabId,
        url: tab.url,
        title: tab.title,
        outcome_summary: summary,
      });
      return { success: true, summary, tabId: targetTabId };
    } catch (err: any) {
      const msg = err?.message || `Failed to switch to tab ${targetTabId}`;
      sendActionFailed(envelope, msg);
      return { success: false, summary: msg };
    }
  }

  // Handle browser_navigate directly via chrome.tabs.update (or create) so it works from any tab including chrome://newtab/
  if (action.type === "browser_navigate") {
    if (!action.url) {
      sendActionFailed(envelope, "Missing URL for browser_navigate");
      return { success: false, summary: "Missing URL for browser_navigate" };
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
      const summary = `Navigated to ${targetUrl}`;
      sendActionFinished(envelope, {
        success: true,
        verified: true,
        tab_id: tabId,
        url: targetUrl,
        outcome_summary: summary,
      });
      return { success: true, summary, tabId };
    } catch (err: any) {
      const msg = err?.message || "Navigation failed";
      sendActionFailed(envelope, msg);
      return { success: false, summary: msg, tabId };
    }
  }

  if (!tabId) {
    sendActionFailed(envelope, "No active browser tab found");
    return { success: false, summary: "No active browser tab found" };
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
      case "browser_dblclick":
      case "browser_rightclick": {
        const [clickRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (loc: any, actionType: string) => {
            function isVisible(el: Element): boolean {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              const style = window.getComputedStyle(el);
              return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
            }

            function findAllNodesDeep(root: ParentNode, predicate: (el: Element) => boolean): Element[] {
              const matched: Element[] = [];
              const search = (node: ParentNode) => {
                let children: Element[] = [];
                try {
                  if (typeof node.querySelectorAll === "function") {
                    children = Array.from(node.querySelectorAll("*"));
                  }
                } catch {}
                for (const child of children) {
                  if (predicate(child)) matched.push(child);
                  if ((child as HTMLElement).shadowRoot) {
                    search((child as HTMLElement).shadowRoot!);
                  }
                }
              };
              search(root);
              return matched;
            }

            function findActiveDialogs(doc: Document): HTMLElement[] {
              const dialogSelectors = [
                '[role="dialog"]',
                '[role="alertdialog"]',
                '[aria-modal="true"]',
                'dialog[open]',
                'dialog:not([hidden])',
                '.modal.show',
                '.modal:not([style*="display: none"])',
                '[data-modal="true"]',
                '[data-state="open"]',
                '[data-radix-portal]',
                '[class*="modal" i]',
                '[class*="dialog" i]',
                '[class*="download-modal" i]',
                '[class*="download-dialog" i]',
                '[class*="download-drawer" i]',
                '[id*="download-modal" i]',
                '[id*="download-dialog" i]',
                '[id*="downloadModal" i]',
              ].join(", ");

              const found = findAllNodesDeep(doc, (el) => {
                if (!isVisible(el)) return false;
                try {
                  if (el.matches(dialogSelectors)) return true;
                } catch {}
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                if (
                  (style.position === "fixed" || style.position === "absolute") &&
                  rect.width > 260 &&
                  rect.height > 160 &&
                  parseInt(style.zIndex || "0", 10) >= 40
                ) {
                  return true;
                }
                return false;
              }) as HTMLElement[];
              return found;
            }

            function triggerClick(el: HTMLElement): { ok: boolean; summary: string; cx: number; cy: number } {
              el.scrollIntoView({ block: "center", inline: "center" });
              const rect = el.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const label =
                el.getAttribute("aria-label") ||
                (el as HTMLInputElement).value ||
                (el.textContent || "").trim().slice(0, 60) ||
                el.tagName.toLowerCase();

              const visualType =
                actionType === "browser_dblclick" ? "dblclick" : actionType === "browser_rightclick" ? "contextmenu" : "click";
              try {
                window.dispatchEvent(
                  new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", {
                    detail: {
                      type: visualType,
                      x: cx,
                      y: cy,
                      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                      label,
                    },
                  })
                );
              } catch {}

              const isRight = actionType === "browser_rightclick";
              const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: isRight ? 2 : 0 };
              el.dispatchEvent(new PointerEvent("pointerdown", opts));
              el.dispatchEvent(new MouseEvent("mousedown", opts));
              el.dispatchEvent(new PointerEvent("pointerup", opts));
              el.dispatchEvent(new MouseEvent("mouseup", opts));
              if (isRight) {
                el.dispatchEvent(new MouseEvent("contextmenu", opts));
                return { ok: true, summary: `Right-clicked "${label}"`, cx, cy };
              } else if (actionType === "browser_dblclick") {
                el.dispatchEvent(new MouseEvent("click", opts));
                el.dispatchEvent(new PointerEvent("pointerdown", opts));
                el.dispatchEvent(new MouseEvent("mousedown", opts));
                el.dispatchEvent(new PointerEvent("pointerup", opts));
                el.dispatchEvent(new MouseEvent("mouseup", opts));
                el.dispatchEvent(new MouseEvent("click", opts));
                el.dispatchEvent(new MouseEvent("dblclick", opts));
                return { ok: true, summary: `Double-clicked "${label}"`, cx, cy };
              } else {
                el.click();
                return { ok: true, summary: `Clicked "${label}"`, cx, cy };
              }
            }

            if (loc?.point) {
              const target = document.elementFromPoint(loc.point.x, loc.point.y) as HTMLElement | null;
              if (target) return triggerClick(target);
            }

            const activeDialogs = findActiveDialogs(document);

            // 1. Strict Index Resolution (never fall through to fuzzy text matching for index locators)
            const indexMatch = loc?.selector?.match(/^\[data-relay-index="(\d+)"\]$/);
            const targetIndex = indexMatch
              ? parseInt(indexMatch[1], 10)
              : typeof loc?.index === "number"
              ? loc.index
              : null;

            if (targetIndex !== null) {
              // Try direct attribute first in dialogs, then document
              for (const d of activeDialogs) {
                const el = d.querySelector(`[data-relay-index="${targetIndex}"]`) as HTMLElement | null;
                if (el && isVisible(el)) {
                  return triggerClick(el);
                }
              }
              const stamped = document.querySelector(`[data-relay-index="${targetIndex}"]`) as HTMLElement | null;
              if (stamped && isVisible(stamped)) {
                return triggerClick(stamped);
              }

              // Stamped attribute missing or stale: reconstruct interactive elements in exact observeTab order
              const selectorQuery =
                'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, [tabindex="0"]';
              const dialogElements: Element[] = [];
              for (const d of activeDialogs) {
                dialogElements.push(...Array.from(d.querySelectorAll(selectorQuery)).filter(isVisible));
              }
              const pageElements = Array.from(document.querySelectorAll(selectorQuery)).filter(isVisible);
              const rawEls = Array.from(new Set([...dialogElements, ...pageElements]));

              const validEls: HTMLElement[] = [];
              const seen = new Set<string>();
              for (const el of rawEls) {
                if (validEls.length >= 120) break;
                const aria = (el.getAttribute("aria-label") || "").trim();
                const placeholder = (el.getAttribute("placeholder") || "").trim();
                const title = (el.getAttribute("title") || "").trim();
                const text = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                const label = (aria || text || placeholder || title).slice(0, 80);
                if (!label) continue;
                const tag = el.tagName.toLowerCase();
                const dedupeKey = `${tag}:${label}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                validEls.push(el as HTMLElement);
              }

              if (targetIndex >= 0 && targetIndex < validEls.length) {
                return triggerClick(validEls[targetIndex]);
              }
              return {
                ok: false,
                error: `Element index [${targetIndex}] not found on page (found ${validEls.length} interactive elements). Run 'browser-relay snapshot' to view updated elements.`,
              };
            }

            // 2. Explicit Text Matching (loc.text)
            if (loc?.text) {
              const textQuery = loc.text.trim().toLowerCase();
              for (const d of activeDialogs) {
                const dlgCandidates = Array.from(
                  d.querySelectorAll('button, a, input, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, label, [onclick]')
                ).filter(isVisible) as HTMLElement[];
                const match = dlgCandidates.find((el) => {
                  const t = (el.innerText || el.textContent || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().toLowerCase();
                  return t === textQuery || t.includes(textQuery);
                });
                if (match) return triggerClick(match);
              }
              const candidates = Array.from(
                document.querySelectorAll(
                  'button, a, input, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, label, [onclick]'
                )
              ).filter(isVisible) as HTMLElement[];
              const match = candidates.find((el) => {
                const t = (el.innerText || el.textContent || el.getAttribute("aria-label") || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().toLowerCase();
                return t === textQuery || t.includes(textQuery);
              });
              if (match) return triggerClick(match);
            }

            if (loc?.selector) {
              try {
                for (const d of activeDialogs) {
                  const el = d.querySelector(loc.selector) as HTMLElement | null;
                  if (el && isVisible(el)) {
                    return triggerClick(el);
                  }
                }
                const el = document.querySelector(loc.selector) as HTMLElement | null;
                if (el && isVisible(el)) {
                  return triggerClick(el);
                }
              } catch {
                // Invalid selector, fall through to name search
              }
            }

            const query = (loc?.name || loc?.selector || "").trim().toLowerCase();
            if (!query) return { ok: false, error: "Empty click locator" };

            const isSaveDownloadQuery = /^(save|download|save as|confirm|accept|ok|save to|get|export)$/i.test(query);

            // Traverse both document and shadow roots for interactive elements
            const candidates = findAllNodesDeep(document, (el) => {
              if (!isVisible(el)) return false;
              try {
                return el.matches(
                  'button, a, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, label, [onclick], [download]'
                );
              } catch {
                return false;
              }
            }) as HTMLElement[];

            let bestEl: HTMLElement | null = null;
            let bestScore = -1;

            for (const el of candidates) {
              const inDialog = activeDialogs.some((d) => d.contains(el));
              const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
              const title = (el.getAttribute("title") || "").trim().toLowerCase();
              const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
              const val = ((el as HTMLInputElement).value || "").trim().toLowerCase();
              const hasDownloadAttr = el.hasAttribute("download");

              let score = -1;
              if (aria === query || text === query || title === query || val === query) {
                score = 1000 - text.length;
              } else if (aria.includes(query) || title.includes(query) || val.includes(query)) {
                score = 700 - aria.length;
              } else if (text.includes(query)) {
                score = 500 - Math.min(text.length, 400);
              } else if (isSaveDownloadQuery) {
                if (
                  aria.includes("download") ||
                  text.includes("download") ||
                  aria.includes("save") ||
                  text.includes("save") ||
                  el.className.toLowerCase().includes("download") ||
                  el.className.toLowerCase().includes("save") ||
                  hasDownloadAttr
                ) {
                  score = inDialog ? 1800 : 750;
                }
              }

              // Active modal/dialog elements get massive priority over background elements
              if (inDialog && score > 0) {
                score += 2500;
              }

              if (score > bestScore) {
                bestScore = score;
                bestEl = el;
              }
            }

            if (bestEl) {
              return triggerClick(bestEl);
            }

            return { ok: false, error: `Could not find clickable element matching "${loc?.name || loc?.selector}"` };
          },
          args: [action.locator || {}, action.type],
        });

        const result = clickRes?.result as { ok: boolean; summary?: string; error?: string; cx?: number; cy?: number } | undefined;
        if (!result?.ok) {
          const errMsg = result?.error || `Element not found: ${JSON.stringify(action.locator)}`;
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }

        // Dispatch hardware-level CDP click/dblclick/rightclick in parallel if attached
        if (typeof result.cx === "number" && typeof result.cy === "number") {
          let hasCdp = tabManager.isAttached(tabId);
          if (hasCdp) {
            try {
              if (action.type === "browser_dblclick") {
                await cdp.doubleClick(tabId, result.cx, result.cy);
              } else if (action.type === "browser_rightclick") {
                await cdp.rightClick(tabId, result.cx, result.cy);
              } else {
                await cdp.click(tabId, result.cx, result.cy);
              }
            } catch {}
          }
        }

        outcome = { success: true, verified: true, outcome_summary: result.summary };
        break;
      }

      case "browser_type": {
        const [typeRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (loc: any, text: string) => {
            function isVisible(el: Element): boolean {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }

            let target: HTMLInputElement | HTMLTextAreaElement | null = null;

            const indexMatch = loc?.selector?.match(/^\[data-relay-index="(\d+)"\]$/);
            const targetIndex = indexMatch
              ? parseInt(indexMatch[1], 10)
              : typeof loc?.index === "number"
              ? loc.index
              : null;

            if (targetIndex !== null) {
              const stamped = document.querySelector(`[data-relay-index="${targetIndex}"]`) as HTMLElement | null;
              if (stamped) {
                target = (stamped.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]')
                  ? stamped
                  : stamped.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]')) as HTMLInputElement | null;
              }
              if (!target) {
                const selectorQuery =
                  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, [tabindex="0"]';
                const rawEls = Array.from(document.querySelectorAll(selectorQuery)).filter(isVisible);
                const validEls: HTMLElement[] = [];
                const seen = new Set<string>();
                for (const el of rawEls) {
                  if (validEls.length >= 120) break;
                  const aria = (el.getAttribute("aria-label") || "").trim();
                  const placeholder = (el.getAttribute("placeholder") || "").trim();
                  const title = (el.getAttribute("title") || "").trim();
                  const t = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                  const label = (aria || t || placeholder || title).slice(0, 80);
                  if (!label) continue;
                  const tag = el.tagName.toLowerCase();
                  const dedupeKey = `${tag}:${label}`;
                  if (seen.has(dedupeKey)) continue;
                  seen.add(dedupeKey);
                  validEls.push(el as HTMLElement);
                }
                if (targetIndex >= 0 && targetIndex < validEls.length) {
                  const el = validEls[targetIndex];
                  target = (el.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]')
                    ? el
                    : el.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]')) as HTMLInputElement | null;
                }
              }
            }

            if (!target && loc?.selector && targetIndex === null) {
              try {
                target = document.querySelector(loc.selector) as HTMLInputElement | null;
              } catch {
                // ignore invalid selector
              }
            }
            if (!target && loc?.name && !/^\d+$/.test(loc.name.trim())) {
              const q = loc.name.toLowerCase();
              const inputs = Array.from(
                document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')
              ).filter(isVisible) as HTMLInputElement[];
              target =
                inputs.find((i) => {
                  const aria = (i.getAttribute("aria-label") || "").toLowerCase();
                  const ph = (i.getAttribute("placeholder") || "").toLowerCase();
                  const name = (i.getAttribute("name") || "").toLowerCase();
                  const id = (i.id || "").toLowerCase();
                  return aria.includes(q) || ph.includes(q) || name.includes(q) || id.includes(q);
                }) || null;
            }
            if (!target) {
              const active = document.activeElement;
              if (active && (active.matches?.('input:not([type="hidden"]), textarea, [contenteditable="true"]') || (active as any).isContentEditable)) {
                target = active as HTMLInputElement;
              } else {
                target = document.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]') as HTMLInputElement | null;
              }
            }
            if (!target) return { ok: false, error: "No input field found on page" };

            target.scrollIntoView({ block: "center", inline: "center" });
            target.focus();
            const rect = target.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const targetLabel = target.getAttribute("aria-label") || target.placeholder || target.tagName;

            try {
              window.dispatchEvent(
                new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", {
                  detail: {
                    type: "type",
                    x: cx,
                    y: cy,
                    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    text,
                    label: targetLabel,
                  },
                })
              );
            } catch {}

            if (target.getAttribute("contenteditable") === "true" || (target as any).isContentEditable) {
              target.innerText = text;
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
              const proto = target instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
              const nativeValueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              if (nativeValueSetter) {
                nativeValueSetter.call(target, text);
              } else {
                target.value = text;
              }
              const tracker = (target as any)._valueTracker;
              if (tracker) {
                tracker.setValue("");
              }
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
            }

            return { ok: true, summary: `Typed into ${target.getAttribute("aria-label") || target.placeholder || target.tagName}` };
          },
          args: [action.locator || {}, action.text || ""],
        });

        const result = typeRes?.result as { ok: boolean; summary?: string; error?: string } | undefined;
        if (!result?.ok) {
          const errMsg = result?.error || "Could not type into input";
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }
        outcome = { success: true, verified: true, outcome_summary: result.summary };
        break;
      }

      case "browser_keypress": {
        const key = action.key || "Enter";
        // Dispatch visual feedback to overlay
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (k: string) => {
              const active = (document.activeElement as HTMLElement) || document.body;
              const rect = active && active !== document.body ? active.getBoundingClientRect() : null;
              const cx = rect && rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
              const cy = rect && rect.height > 0 ? rect.top + rect.height / 2 : window.innerHeight / 2;
              try {
                window.dispatchEvent(
                  new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", {
                    detail: {
                      type: "keypress",
                      x: cx,
                      y: cy,
                      key: k,
                      rect: rect && rect.width > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined,
                    },
                  })
                );
              } catch {}
            },
            args: [key],
          });
        } catch {}

        let hasCdp = tabManager.isAttached(tabId);
        if (!hasCdp) hasCdp = await tabManager.attachTab(tabId);
        if (hasCdp && action.key) {
          await cdp.keypress(tabId, action.key);
        } else {
          // Synthetic keyboard event fallback
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              func: (k: string) => {
                const target = (document.activeElement as HTMLElement) || document.body;
                const opts = { key: k, code: k, bubbles: true, cancelable: true };
                target.dispatchEvent(new KeyboardEvent("keydown", opts));
                target.dispatchEvent(new KeyboardEvent("keypress", opts));
                target.dispatchEvent(new KeyboardEvent("keyup", opts));
              },
              args: [key],
            });
          } catch {}
        }
        outcome = { success: true, verified: true, outcome_summary: `Pressed ${action.key}` };
        break;
      }

      case "browser_scroll": {
        const dir = action.scroll_direction || "down";
        const amt = action.scroll_amount || 450;
        const deltaY = dir === "down" ? amt : dir === "up" ? -amt : 0;
        const deltaX = dir === "right" ? amt : dir === "left" ? -amt : 0;
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (dx: number, dy: number, direction: string, amount: number) => {
            try {
              window.dispatchEvent(
                new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", {
                  detail: {
                    type: "scroll",
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2,
                    direction,
                    amount,
                  },
                })
              );
            } catch {}
            window.scrollBy({ left: dx, top: dy, behavior: "smooth" });
          },
          args: [deltaX, deltaY, dir, amt],
        });
        outcome = { success: true, verified: true, outcome_summary: `Scrolled ${dir} (${amt}px)` };
        break;
      }

      case "browser_hover": {
        const [hoverRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (loc: any) => {
            function isVisible(el: Element): boolean {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              const style = window.getComputedStyle(el);
              return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
            }

            function triggerHover(el: HTMLElement): { summary: string; cx: number; cy: number } {
              el.scrollIntoView({ block: "center", inline: "center" });
              const rect = el.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const label =
                el.getAttribute("aria-label") ||
                (el as HTMLInputElement).value ||
                (el.textContent || "").trim().slice(0, 60) ||
                el.tagName.toLowerCase();

              try {
                window.dispatchEvent(
                  new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", {
                    detail: {
                      type: "hover",
                      x: cx,
                      y: cy,
                      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                      label,
                    },
                  })
                );
              } catch {}

              const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
              el.dispatchEvent(new PointerEvent("pointerover", opts));
              el.dispatchEvent(new MouseEvent("mouseover", opts));
              el.dispatchEvent(new PointerEvent("pointerenter", opts));
              el.dispatchEvent(new MouseEvent("mouseenter", opts));
              el.dispatchEvent(new PointerEvent("pointermove", opts));
              el.dispatchEvent(new MouseEvent("mousemove", opts));
              return { summary: `Hovered "${label}"`, cx, cy };
            }

            if (loc?.point) {
              const target = document.elementFromPoint(loc.point.x, loc.point.y) as HTMLElement | null;
              if (target) {
                const res = triggerHover(target);
                return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
              }
            }

            const activeDialogs = Array.from(
              document.querySelectorAll(
                '[role="dialog"], [aria-modal="true"], dialog[open], .modal.show, .modal:not([style*="display: none"]), [data-modal="true"]'
              )
            ).filter(isVisible);

            const indexMatch = loc?.selector?.match(/^\[data-relay-index="(\d+)"\]$/);
            const targetIndex = indexMatch
              ? parseInt(indexMatch[1], 10)
              : typeof loc?.index === "number"
              ? loc.index
              : null;

            if (targetIndex !== null) {
              for (const d of activeDialogs) {
                const el = d.querySelector(`[data-relay-index="${targetIndex}"]`) as HTMLElement | null;
                if (el && isVisible(el)) {
                  const res = triggerHover(el);
                  return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
                }
              }
              const stamped = document.querySelector(`[data-relay-index="${targetIndex}"]`) as HTMLElement | null;
              if (stamped && isVisible(stamped)) {
                const res = triggerHover(stamped);
                return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
              }
            }

            if (loc?.selector) {
              try {
                for (const d of activeDialogs) {
                  const el = d.querySelector(loc.selector) as HTMLElement | null;
                  if (el && isVisible(el)) {
                    const res = triggerHover(el);
                    return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
                  }
                }
                const el = document.querySelector(loc.selector) as HTMLElement | null;
                if (el && isVisible(el)) {
                  const res = triggerHover(el);
                  return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
                }
              } catch {}
            }

            const query = (loc?.name || loc?.text || "").trim().toLowerCase();
            if (query && !/^\d+$/.test(query)) {
              for (const d of activeDialogs) {
                const dlgElements = Array.from(
                  d.querySelectorAll('button, a, input, [role="button"], [role="menuitem"], label, summary, [tabindex="0"]')
                ).filter(isVisible) as HTMLElement[];
                const match = dlgElements.find((el) => {
                  const t = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
                  return t.includes(query);
                });
                if (match) {
                  const res = triggerHover(match);
                  return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
                }
              }
              const pageCandidates = Array.from(
                document.querySelectorAll('button, a, input, [role="button"], [role="menuitem"], label, summary, [tabindex="0"]')
              ).filter(isVisible) as HTMLElement[];
              const match = pageCandidates.find((el) => {
                const t = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
                return t.includes(query);
              });
              if (match) {
                const res = triggerHover(match);
                return { ok: true, summary: res.summary, x: res.cx, y: res.cy };
              }
            }

            return { ok: false, error: "Could not find element to hover" };
          },
          args: [action.locator || {}],
        });

        const hoverOut = hoverRes?.result as any;
        if (!hoverOut?.ok) {
          const errMsg = hoverOut?.error || "Hover failed";
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }

        if (typeof hoverOut.x === "number" && typeof hoverOut.y === "number") {
          let hasCdp = tabManager.isAttached(tabId);
          if (hasCdp) {
            try {
              await cdp.mouseMove(tabId, hoverOut.x, hoverOut.y);
            } catch {}
          }
        }

        outcome = { success: true, verified: true, outcome_summary: hoverOut.summary };
        break;
      }

      case "browser_snapshot": {
        const snap = await observeTab(tabId);
        outcome = { success: true, verified: true, snapshot: snap };
        break;
      }

      case "browser_screenshot": {
        let base64 = "";
        let debugError = "";

        // Attempt 1: CDP captureScreenshot
        try {
          let hasCdp = tabManager.isAttached(tabId);
          if (!hasCdp) hasCdp = await tabManager.attachTab(tabId);
          if (hasCdp) {
            base64 = await cdp.captureScreenshot(tabId);
          }
        } catch (e: any) {
          debugError = `cdp: ${e?.message || e}`;
        }

        // Attempt 2: captureVisibleTab
        if (!base64) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.active) {
              await chrome.tabs.update(tabId, { active: true });
              await new Promise((r) => setTimeout(r, 100));
            }
            const dataUrl = await Promise.race([
              chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
              new Promise<string>((_, reject) => setTimeout(() => reject(new Error("captureVisibleTab timed out")), 2000)),
            ]);
            if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
              base64 = dataUrl.split(",")[1] || "";
            }
          } catch (e: any) {
            debugError += ` | captureVisibleTab: ${e?.message || e}`;
          }
        }

        if (!base64) {
          const errMsg = `Screenshot failed: ${debugError || "Unknown error"}`;
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }

        outcome = { success: true, verified: true, screenshot_base64: base64, outcome_summary: "Captured screenshot" };
        break;
      }

      case "browser_pdf": {
        let pdfBase64 = "";
        let hasCdp = tabManager.isAttached(tabId);
        if (!hasCdp) hasCdp = await tabManager.attachTab(tabId);
        if (hasCdp) {
          try {
            pdfBase64 = await cdp.printToPDF(tabId);
          } catch (e: any) {
            sendActionFailed(envelope, `PDF generation failed: ${e?.message || e}`);
            return { success: false, summary: `PDF failed: ${e?.message || e}`, tabId };
          }
        } else {
          sendActionFailed(envelope, "CDP debugger attachment required for PDF generation");
          return { success: false, summary: "CDP not attached", tabId };
        }
        outcome = {
          success: true,
          verified: true,
          pdf_base64: pdfBase64,
          outcome_summary: "Generated PDF document",
        };
        break;
      }

      case "browser_download": {
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
          outcome = {
            success: true,
            verified: true,
            download_id: downloadId,
            url: action.url,
            outcome_summary: `Downloaded ${action.url}`,
          };
        } else {
          sendActionFailed(envelope, "Missing url for browser_download");
          return { success: false, summary: "Missing url for browser_download", tabId };
        }
        break;
      }

      case "browser_upload": {
        const uploadSelector = action.locator?.selector || 'input[type="file"]';
        const files = action.file_paths || [];
        if (files.length === 0) {
          sendActionFailed(envelope, "No file_paths specified for browser_upload");
          return { success: false, summary: "No file_paths specified", tabId };
        }
        let hasCdp = tabManager.isAttached(tabId);
        if (!hasCdp) hasCdp = await tabManager.attachTab(tabId);
        const uploadSuccess = hasCdp ? await cdp.setFileInputFiles(tabId, uploadSelector, files) : false;
        outcome = { success: uploadSuccess, verified: uploadSuccess, uploaded_files: files };
        break;
      }

      case "browser_extract": {
        const [extRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel: string | null) => {
            const root = (sel ? document.querySelector(sel) : document.body) as HTMLElement | null;
            if (!root) {
              return { ok: false, error: `Selector not found: ${sel}` };
            }
            const text = (root.innerText || root.textContent || "").trim();
            const links = Array.from(root.querySelectorAll("a[href]"))
              .slice(0, 100)
              .map((a) => ({
                text: ((a as HTMLElement).innerText || a.textContent || "").replace(/\s+/g, " ").trim(),
                href: (a as HTMLAnchorElement).href,
              }))
              .filter((l) => l.href && !l.href.startsWith("javascript:"));
            return {
              ok: true,
              url: window.location.href,
              title: document.title,
              text: text.slice(0, 50000),
              links,
            };
          },
          args: [action.locator?.selector || null],
        });
        const extracted = extRes?.result as any;
        if (!extracted?.ok) {
          const errMsg = extracted?.error || "Extraction failed";
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }
        outcome = {
          success: true,
          verified: true,
          extracted,
          outcome_summary: `Extracted ${extracted.text?.length || 0} chars and ${extracted.links?.length || 0} links`,
        };
        break;
      }

      case "browser_eval": {
        const code = action.text || action.value || action.predicate || "";
        let evalVal: any;
        let evalError: string | null = null;
        let evaluated = false;

        let hasCdp = tabManager.isAttached(tabId);
        if (!hasCdp) hasCdp = await tabManager.attachTab(tabId);
        if (hasCdp) {
          try {
            evalVal = await cdp.evaluate(tabId, code);
            evaluated = true;
          } catch (cdpErr: any) {
            evalError = cdpErr?.message || String(cdpErr);
          }
        }

        if (!evaluated) {
          try {
            const [evalRes] = await chrome.scripting.executeScript({
              target: { tabId },
              func: (expr: string) => {
                try {
                  const fn = new Function(`return (${expr})`);
                  return { ok: true, result: fn() };
                } catch {
                  try {
                    const fnBlock = new Function(expr);
                    return { ok: true, result: fnBlock() };
                  } catch (err: any) {
                    return { ok: false, error: err?.message || String(err) };
                  }
                }
              },
              args: [code],
            });
            const resObj = evalRes?.result as any;
            if (resObj?.ok) {
              evalVal = resObj.result;
              evaluated = true;
            } else {
              evalError = resObj?.error || evalError || "Eval failed";
            }
          } catch (scrErr: any) {
            evalError = scrErr?.message || evalError || "Eval failed";
          }
        }

        if (!evaluated) {
          sendActionFailed(envelope, evalError || "Eval failed");
          return { success: false, summary: evalError || "Eval failed", tabId };
        }

        outcome = {
          success: true,
          verified: true,
          eval_result: evalVal,
          outcome_summary: `Evaluated JS expression`,
        };
        break;
      }

      case "browser_select": {
        const [selRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (loc: any, val: string) => {
            const sel = loc?.selector
              ? (document.querySelector(loc.selector) as HTMLSelectElement | null)
              : (document.querySelector("select") as HTMLSelectElement | null);
            if (!sel) return { ok: false, error: "Select element not found" };
            const option = Array.from(sel.options).find(
              (o) => o.value === val || (o.textContent || "").trim().toLowerCase() === val.toLowerCase()
            );
            if (option) {
              sel.value = option.value;
            } else {
              sel.value = val;
            }
            sel.dispatchEvent(new Event("input", { bubbles: true }));
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: true, summary: `Selected "${val}"` };
          },
          args: [action.locator || {}, action.value || action.text || ""],
        });
        const selOut = selRes?.result as any;
        if (!selOut?.ok) {
          const errMsg = selOut?.error || "Select failed";
          sendActionFailed(envelope, errMsg);
          return { success: false, summary: errMsg, tabId };
        }
        outcome = { success: true, verified: true, outcome_summary: selOut.summary };
        break;
      }

      case "browser_wait": {
        const timeoutMs = action.timeout_ms || 5000;
        const selector = action.locator?.selector || null;
        const text = action.text || action.locator?.text || null;
        if (!selector && !text) {
          await new Promise((r) => setTimeout(r, timeoutMs));
          outcome = { success: true, verified: true, outcome_summary: `Waited ${timeoutMs}ms` };
          break;
        }
        const start = Date.now();
        let found = false;
        while (Date.now() - start < timeoutMs) {
          const [waitRes] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (s: string | null, t: string | null) => {
              if (s && document.querySelector(s)) return true;
              if (t && document.body?.innerText?.toLowerCase().includes(t.toLowerCase())) return true;
              return false;
            },
            args: [selector, text],
          });
          if (waitRes?.result) {
            found = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        outcome = {
          success: found,
          verified: found,
          outcome_summary: found ? `Condition met within ${Date.now() - start}ms` : `Wait timed out after ${timeoutMs}ms`,
        };
        break;
      }

      case "browser_verify": {
        const [verRes] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel: string | null, txt: string) =>
            Boolean(sel ? document.querySelector(sel) : document.body.innerText.includes(txt)),
          args: [action.locator?.selector || null, action.text || ""],
        });
        const verified = Boolean(verRes?.result);
        outcome = { success: verified, verified, outcome_summary: verified ? "Verified" : "Verification failed" };
        break;
      }

      default:
        outcome = { success: true, verified: true };
    }

    sendActionFinished(envelope, outcome);
    return {
      success: true,
      summary: outcome?.outcome_summary || `${action.type} succeeded`,
      tabId,
    };
  } catch (err: any) {
    const msg = err?.message || "Action failed";
    sendActionFailed(envelope, msg);
    return { success: false, summary: msg, tabId };
  }
}

interface TabObservation {
  url: string;
  title: string;
  headings: string[];
  elements: Array<{
    index: number;
    tag: string;
    role: string;
    label: string;
    selector: string;
    href?: string;
  }>;
}

async function observeTab(tabId?: number | null): Promise<TabObservation> {
  const tab = await resolveActiveTab(tabId);
  if (!tab?.id) {
    return { url: "about:blank", title: "No Tab", headings: [], elements: [] };
  }
  const currentUrl = tab.url || "about:blank";
  const currentTitle = tab.title || "Untitled";
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(currentUrl)) {
    return { url: currentUrl, title: currentTitle, headings: [], elements: [] };
  }

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function isVisible(el: Element): boolean {
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) return false;
          const style = window.getComputedStyle(el);
          return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
        }

        function buildSelector(el: Element): string {
          if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
            return `#${el.id}`;
          }
          const testId =
            el.getAttribute("data-test-id") ||
            el.getAttribute("data-testid") ||
            el.getAttribute("cfc-test-id");
          if (testId) return `[data-test-id="${testId}"], [data-testid="${testId}"], [cfc-test-id="${testId}"]`;
          const aria = el.getAttribute("aria-label");
          if (aria && !aria.includes('"') && aria.length < 60) {
            return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`;
          }
          const name = el.getAttribute("name");
          if (name && !name.includes('"')) {
            return `${el.tagName.toLowerCase()}[name="${name}"]`;
          }
          return "";
        }

        const dialogSelectors = [
          '[role="dialog"]',
          '[role="alertdialog"]',
          '[aria-modal="true"]',
          'dialog[open]',
          'dialog:not([hidden])',
          '.modal.show',
          '.modal:not([style*="display: none"])',
          '[data-modal="true"]',
          '[data-state="open"]',
          '[data-radix-portal]',
          '[class*="modal" i]',
          '[class*="dialog" i]',
          '[class*="download-modal" i]',
          '[class*="download-dialog" i]',
          '[class*="download-drawer" i]',
          '[id*="download-modal" i]',
          '[id*="download-dialog" i]',
          '[id*="downloadModal" i]',
        ].join(", ");

        function findNodesDeep(root: ParentNode, predicate: (el: Element) => boolean): Element[] {
          const matched: Element[] = [];
          const search = (node: ParentNode) => {
            let children: Element[] = [];
            try {
              if (typeof node.querySelectorAll === "function") {
                children = Array.from(node.querySelectorAll("*"));
              }
            } catch {}
            for (const child of children) {
              if (predicate(child)) matched.push(child);
              if ((child as HTMLElement).shadowRoot) {
                search((child as HTMLElement).shadowRoot!);
              }
            }
          };
          search(root);
          return matched;
        }

        const activeDialogs = findNodesDeep(document, (el) => {
          if (!isVisible(el)) return false;
          try {
            if (el.matches(dialogSelectors)) return true;
          } catch {}
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            (style.position === "fixed" || style.position === "absolute") &&
            rect.width > 260 &&
            rect.height > 160 &&
            parseInt(style.zIndex || "0", 10) >= 40
          ) {
            return true;
          }
          return false;
        }) as HTMLElement[];

        const dialogHeadings = activeDialogs.flatMap((d) =>
          Array.from(d.querySelectorAll('h1, h2, h3, [role="heading"], [class*="title"], [class*="header"]'))
            .filter(isVisible)
            .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
        );

        const pageHeadings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
          .filter(isVisible)
          .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        const headings = Array.from(new Set([...dialogHeadings, ...pageHeadings])).slice(0, 15);

        const selectorQuery =
          'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], mat-select, mat-option, summary, [tabindex="0"]';

        const dialogElements: Element[] = [];
        for (const d of activeDialogs) {
          dialogElements.push(...findNodesDeep(d, (el) => {
            if (!isVisible(el)) return false;
            try { return el.matches(selectorQuery); } catch { return false; }
          }));
        }

        const pageElements = findNodesDeep(document, (el) => {
          if (!isVisible(el)) return false;
          try { return el.matches(selectorQuery); } catch { return false; }
        });

        // Modal / dialog interactive elements ALWAYS go first!
        const rawEls = Array.from(new Set([...dialogElements, ...pageElements]));

        const elements: Array<{
          index: number;
          tag: string;
          role: string;
          label: string;
          selector: string;
          href?: string;
        }> = [];
        const seenLabels = new Set<string>();

        for (const el of rawEls) {
          if (elements.length >= 120) break;
          const aria = (el.getAttribute("aria-label") || "").trim();
          const placeholder = (el.getAttribute("placeholder") || "").trim();
          const title = (el.getAttribute("title") || "").trim();
          const text = ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          const label = (aria || text || placeholder || title).slice(0, 80);
          if (!label) continue;

          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || tag;
          const index = elements.length;
          try {
            el.setAttribute("data-relay-index", String(index));
          } catch {}
          const selector = buildSelector(el) || `[data-relay-index="${index}"]`;
          const href = tag === "a" ? (el as HTMLAnchorElement).href : undefined;
          const dedupeKey = `${tag}:${label}:${selector}`;
          if (seenLabels.has(dedupeKey)) continue;
          seenLabels.add(dedupeKey);

          elements.push({
            index,
            tag,
            role,
            label,
            selector,
            href: href && !href.startsWith("javascript:") ? href.slice(0, 100) : undefined,
          });
        }

        return {
          url: window.location.href,
          title: document.title,
          headings,
          elements,
          is_modal_active: activeDialogs.length > 0,
          modal_title: dialogHeadings[0] || null,
        };
      },
    });
    return (res?.result as TabObservation) || { url: currentUrl, title: currentTitle, headings: [], elements: [] };
  } catch {
    return { url: currentUrl, title: currentTitle, headings: [], elements: [] };
  }
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
    payload: { ...outcome, from_extension: true },
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
    payload: { error, from_extension: true },
  };

  try {
    chrome.runtime.sendMessage(failedEnvelope);
  } catch {
    // Side panel might be closed
  }

  nativePort.send(failedEnvelope);
}

// Track active multi-step agent runs so PAUSE / STOP work immediately
const activeRuns: Map<string, { status: "running" | "paused" | "stopped"; token: number }> = new Map();

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
    const runId = request.run_id || "run_1";
    nativePort.send({
      command: request.command,
      run_id: runId,
      epoch: request.epoch,
      instruction: request.instruction,
    });
    if (request.command === "stop") {
      const current = activeRuns.get(runId);
      if (current) current.status = "stopped";
    } else if (request.command === "pause" || request.command === "take_over") {
      const current = activeRuns.get(runId);
      if (current) current.status = "paused";
    } else if (request.command === "resume" || request.command === "return_control") {
      const current = activeRuns.get(runId);
      if (current) current.status = "running";
    } else if (request.command === "restart") {
      const current = activeRuns.get(runId);
      if (current) current.status = "stopped";
    } else if (request.command === "steer" && request.instruction) {
      void handleUserChat(
        runId,
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
      timestamp: new Date().toISOString(),
      run_id: request.run_id,
      payload: request.payload,
    });
    sendResponse({ success: true });
  }
});

const ACTIVE_NIM_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b",
  "openai/gpt-oss-20b",
  "poolside/laguna-xs-2.1",
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

  // Direct URL, domain, or spoken "example dot com"
  const dotNormalized = trimmed.replace(/\s+dot\s+(com|org|net|io|ai|dev|edu|gov|co)\b/gi, ".$1");
  if (
    /^https?:\/\/[^\s]+$/i.test(dotNormalized) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(dotNormalized)
  ) {
    return { type: "browser_navigate", url: normalizeUrl(dotNormalized) } as ActionPayload;
  }

  // Check if user mentions a known console/site anywhere in a navigation/credential command
  for (const entry of KNOWN_SITES) {
    if (
      entry.pattern.test(trimmed) &&
      /\b(navigate|navagate|nav|go|open|visit|browse|find|create|get|download|enable|console|consuil|oauth|credentials?)\b/i.test(
        trimmed
      )
    ) {
      return { type: "browser_navigate", url: entry.url } as ActionPayload;
    }
  }

  // Natural language navigation (single or multi-word): "navigate to my Google cloud consuil", "go to example dot com"
  const navMatch = trimmed.match(
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:navigate|navagate|nav|go|open|visit|browse|head|take\s+me|switch|load|launch)\s+(?:to\s+|up\s+|into\s+)?(.+?)[?.!]*$/i
  );
  if (navMatch && navMatch[1]) {
    const rawTarget = navMatch[1]
      .split(/\b(?:and\s+then|and\s+find|and\s+create|then\s+|find\s+my)\b/i)[0]
      .trim();
    return { type: "browser_navigate", url: normalizeUrl(rawTarget) } as ActionPayload;
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

  // Natural language click: "click [on] [the] X"
  const clickMatch = trimmed.match(/^(?:please\s+)?click\s+(?:on\s+)?(?:the\s+)?(.+?)[?.!]*$/i);
  if (clickMatch && clickMatch[1]) {
    const targetName = clickMatch[1].replace(/^["']|["']$/g, "").trim();
    return {
      type: "browser_click",
      locator: targetName.startsWith("#") || targetName.startsWith(".")
        ? { selector: targetName }
        : { name: targetName },
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

function extractStepFromModelReply(
  replyText: string,
  userText: string,
  isFirstStep: boolean
): { cleanReply: string; action: ActionPayload | null; done: boolean } {
  let cleanReply = replyText;
  let action: ActionPayload | null = null;
  let done = false;

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(replyText)) !== null) {
    const objs = extractBalancedJsonObjects(match[1]);
    for (const obj of objs) {
      if (typeof obj.parsed?.done === "boolean") done = obj.parsed.done;
      if (typeof obj.parsed?.thought === "string" && !cleanReply.replace(match[0], "").trim()) {
        cleanReply = obj.parsed.thought;
      }
      const candidate = obj.parsed?.action || (obj.parsed?.type ? obj.parsed : null);
      if (candidate && typeof candidate.type === "string") {
        action = candidate as ActionPayload;
        cleanReply = cleanReply.replace(match[0], "").trim() || obj.parsed?.thought || "";
        break;
      }
    }
    if (action) break;
  }

  if (!action) {
    const objs = extractBalancedJsonObjects(replyText);
    for (const obj of objs) {
      if (typeof obj.parsed?.done === "boolean") done = obj.parsed.done;
      const candidate = obj.parsed?.action || (obj.parsed?.type ? obj.parsed : null);
      if (candidate && typeof candidate.type === "string") {
        action = candidate as ActionPayload;
        cleanReply = cleanReply.replace(obj.raw, "").trim() || obj.parsed?.thought || "";
        break;
      }
    }
  }

  if (action && !action.type.startsWith("browser_")) {
    action = { ...action, type: `browser_${action.type}` as any };
  }

  if (
    !action &&
    isFirstStep &&
    /\b(navigate|navagate|nav|go|open|visit|browse|take\s+me|launch|load)\b/i.test(userText)
  ) {
    const urlInReply = replyText.match(/https?:\/\/[^\s)"'`>\]]+/i);
    if (urlInReply && urlInReply[0]) {
      action = { type: "browser_navigate", url: urlInReply[0].replace(/[.,;]+$/, "") } as ActionPayload;
    }
  }

  if (!action && isFirstStep) {
    action = inferActionFromUserIntent(userText);
  }

  if (action && /\b(cannot|can't|unable|don't have access|as an ai|do not have the ability)\b/i.test(cleanReply)) {
    cleanReply =
      action.type === "browser_navigate"
        ? `Navigating to ${action.url}...`
        : `Executing ${action.type}...`;
  }

  return { cleanReply, action, done };
}

async function callNvidiaNim(
  apiKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<{ content: string; modelUsed: string }> {
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
          messages,
          temperature: 0.15,
          max_tokens: 1500,
        }),
      });
      if (!res.ok) continue;
      const data: any = await res.json();
      const msg = data?.choices?.[0]?.message;
      const content = (msg?.content || "").trim();
      if (content) {
        return { content, modelUsed: model };
      }
    } catch {
      // Try next fallback model
    }
  }
  return { content: "", modelUsed: ACTIVE_NIM_MODELS[0] };
}

async function handleUserChat(
  runId: string,
  epoch: number,
  userText: string,
  history: Array<{ role: string; text: string }>,
  preferredTabId?: number | null
): Promise<void> {
  const runToken = Date.now();
  activeRuns.set(runId, { status: "running", token: runToken });

  try {
    let activeTab = await resolveActiveTab(preferredTabId);
    let currentTabId = activeTab?.id;

    const apiKey = await getNvidiaApiKey();
    if (!apiKey) {
      const fallbackAction = inferActionFromUserIntent(userText);
      if (fallbackAction) {
        broadcastChatResponse(runId, epoch, `Executing ${fallbackAction.type}...`, "local");
        await dispatchBrowserAction(runId, epoch, currentTabId, fallbackAction);
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

    const MAX_STEPS = 10;
    const stepHistory: string[] = [];

    for (let step = 1; step <= MAX_STEPS; step++) {
      const runState = activeRuns.get(runId);
      if (!runState || runState.token !== runToken || runState.status === "stopped") {
        break;
      }
      while (activeRuns.get(runId)?.status === "paused") {
        await new Promise((r) => setTimeout(r, 400));
        if (activeRuns.get(runId)?.status === "stopped") return;
      }

      const obs = await observeTab(currentTabId);
      const elementsSummary =
        obs.elements.length > 0
          ? obs.elements
              .map(
                (e) =>
                  `[${e.index}] <${e.tag}> "${e.label}"${e.selector ? ` selector='${e.selector}'` : ""}${
                    e.href ? ` href='${e.href}'` : ""
                  }`
              )
              .join("\n")
          : "(No interactive DOM elements visible or on internal browser page)";

      const systemPrompt = [
        "You are the OpenCode Chrome Relay autonomous multi-step browser agent running inside the user's Chrome Side Panel.",
        "You have full permission to navigate and interact with the user's logged-in Chrome browser tabs.",
        "CRITICAL RULES:",
        "1. NEVER refuse a task or claim you cannot access personal accounts/consoles.",
        "2. For normal chat (like 'ping' or questions that need no browser actions), reply concisely in plain text with no JSON block.",
        "3. For single or multi-step browser tasks, execute ONE action per step based on the Current Page Observation and Past Steps.",
        "4. Useful Google Cloud Console direct URLs (use browser_navigate to jump directly when relevant):",
        "   - APIs & Credentials (OAuth Client IDs / Secrets): https://console.cloud.google.com/apis/credentials",
        "   - Create OAuth Client ID directly: https://console.cloud.google.com/apis/credentials/oauthclient",
        "   - Enable YouTube Data API v3: https://console.cloud.google.com/apis/library/youtube.googleapis.com",
        "   - Enable YouTube Analytics API: https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com",
        "   - IAM & Admin Permissions: https://console.cloud.google.com/iam-admin/iam",
        "5. Output a brief 1-sentence explanation of the current step followed by a JSON block in this exact format:",
        '```json\n{"done":false,"action":{"type":"browser_navigate","url":"https://console.cloud.google.com/apis/credentials"}}\n```',
        '   - For clicking an element from the observation list: {"done":false,"action":{"type":"browser_click","locator":{"name":"exact button label","selector":"optional css selector"}}}',
        '   - For typing into an input: {"done":false,"action":{"type":"browser_type","locator":{"name":"field label","selector":"optional css selector"},"text":"value"}}',
        '   - For scrolling: {"done":false,"action":{"type":"browser_scroll","scroll_direction":"down","scroll_amount":450}}',
        '   - When the user goal is complete (or awaiting user sign-in/confirmation), set "done":true and omit "action".',
      ].join("\n");

      const stepContext = [
        `User Goal: ${userText}`,
        `Current Step: ${step} of ${MAX_STEPS}`,
        `Current Tab URL: ${obs.url}`,
        `Current Tab Title: ${obs.title}`,
        obs.headings.length ? `Visible Headings: ${obs.headings.join(" | ")}` : "",
        stepHistory.length ? `Actions Taken So Far:\n${stepHistory.join("\n")}` : "Actions Taken So Far: (none yet)",
        `Visible Interactive Elements on Page:\n${elementsSummary}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const priorChat =
        step === 1
          ? history
              .slice(-4)
              .filter((m) => m.text && m.text !== "Thinking...")
              .map((m) => ({
                role: (m.role === "agent" ? "assistant" : "user") as "assistant" | "user",
                content: m.text,
              }))
          : [];

      const { content: replyText, modelUsed } = await callNvidiaNim(apiKey, [
        { role: "system", content: systemPrompt },
        ...priorChat,
        { role: "user", content: stepContext },
      ]);

      const { cleanReply, action: parsedAction, done } = extractStepFromModelReply(
        replyText,
        userText,
        step === 1
      );

      const displayMessage =
        cleanReply ||
        (parsedAction?.type === "browser_navigate"
          ? `Step ${step}: Navigating to ${parsedAction.url}...`
          : parsedAction
            ? `Step ${step}: Executing ${parsedAction.type}...`
            : "Task complete.");

      broadcastChatResponse(runId, epoch, displayMessage, modelUsed);

      if (!parsedAction || done) {
        break;
      }

      const execRes = await dispatchBrowserAction(runId, epoch, currentTabId, parsedAction);
      if (execRes.tabId) currentTabId = execRes.tabId;

      stepHistory.push(
        `Step ${step}: ${parsedAction.type} (${
          parsedAction.url || parsedAction.locator?.name || parsedAction.locator?.selector || ""
        }) -> ${execRes.success ? "SUCCESS" : "FAILED"}: ${execRes.summary}`
      );

      // If this was a simple 1-step navigation request (e.g. "navigate to example.com") with no follow-up clauses, finish after step 1
      const isSimpleNavOnly =
        step === 1 &&
        parsedAction.type === "browser_navigate" &&
        !/\b(find|create|click|download|enable|fill|type|select|delete|update|and\s+then|then)\b/i.test(
          userText.replace(/^(?:please\s+)?(?:navigate|navagate|go|open|visit)\s+(?:to\s+)?/i, "")
        );
      if (isSimpleNavOnly) {
        break;
      }

      // Wait briefly for SPA rendering / dialogs to settle before next observation
      await new Promise((r) => setTimeout(r, 1800));
    }
  } catch (err: any) {
    broadcastChatResponse(runId, epoch, `Error: ${err?.message || "Failed to contact agent"}`, "error");
  } finally {
    const current = activeRuns.get(runId);
    if (current?.token === runToken) {
      activeRuns.delete(runId);
    }
    nativePort.send({
      v: 1,
      event: "run.completed",
      event_id: `evt_done_${Date.now()}`,
      timestamp: new Date().toISOString(),
      run_id: runId,
      epoch,
      payload: { from_extension: true },
    });
  }
}

async function dispatchBrowserAction(
  runId: string,
  epoch: number,
  tabId: number | undefined,
  action: ActionPayload
): Promise<{ success: boolean; summary: string; tabId?: number }> {
  const actionEnvelope: ProtocolEnvelope = {
    v: 1,
    event: "action.started",
    event_id: `evt_act_${Date.now()}`,
    timestamp: new Date().toISOString(),
    run_id: runId,
    epoch,
    tab_id: tabId,
    idempotency_key: `idem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action,
    payload: { from_extension: true },
  };
  try {
    chrome.runtime.sendMessage(actionEnvelope);
  } catch {
    // Sidepanel closed
  }
  nativePort.send(actionEnvelope);
  return await handleActionRequest(actionEnvelope);
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
      from_extension: true,
    },
  };
  try {
    chrome.runtime.sendMessage(envelope);
  } catch {
    // Sidepanel closed
  }
  nativePort.send(envelope);
}
