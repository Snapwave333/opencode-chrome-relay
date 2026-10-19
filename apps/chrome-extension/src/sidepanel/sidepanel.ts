// Side panel UI Logic with Multi-Session Tabbed Interface, Live Chat & Pinning
import { getMaterial3Svg, Material3IconName } from "../shared/material_icons.js";

interface ActionItem {
  id: string;
  type: string;
  target?: string;
  details?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "active" | "success" | "failed";
  statusText?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  pending?: boolean;
  failed?: boolean;
  // An extension op waiting for the user's click (Chrome needs a user gesture for it)
  confirm?: { requestId: string; op: "uninstall" | "disable" | "enable"; id: string; name: string };
}

interface SessionData {
  runId: string;
  name: string;
  isPinned: boolean;
  state: string;
  epoch: number;
  tabId: number | null;
  messages: ChatMessage[];
  actions: ActionItem[];
  verifiedCount: number;
  userHue: number; // avatar colour for this chat, picked at random
}

const statusBadge = document.getElementById("bridge-status-badge") as HTMLElement;
const statusText = document.getElementById("bridge-status-text") as HTMLElement;
const modelNameLabel = document.getElementById("model-name") as HTMLElement;
const tabsList = document.getElementById("tabs-list") as HTMLDivElement;
const btnNewSession = document.getElementById("btn-new-session") as HTMLButtonElement;
const sessionNameText = document.getElementById("session-name") as HTMLElement;
const tabStatusText = document.getElementById("tab-status") as HTMLElement;
const sessionPinStatus = document.getElementById("session-pin-status") as HTMLElement;
const sessionActionStats = document.getElementById("session-action-stats") as HTMLElement;
const btnTogglePin = document.getElementById("btn-toggle-pin") as HTMLButtonElement;
const btnDeleteSession = document.getElementById("btn-delete-session") as HTMLButtonElement;
const btnAttachTab = document.getElementById("btn-attach-tab") as HTMLButtonElement;
const liveActionBox = document.getElementById("live-action-box") as HTMLElement;
const liveDot = document.getElementById("live-dot") as HTMLElement;
const liveActionText = document.getElementById("live-action-text") as HTMLElement;
const activityFeed = document.getElementById("activity-feed") as HTMLDivElement;
const chatMessagesContainer = document.getElementById("chat-messages") as HTMLElement;
const timelineContainer = document.getElementById("timeline") as HTMLElement;

const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnRestart = document.getElementById("btn-restart") as HTMLButtonElement;
const btnSteer = document.getElementById("btn-steer-send") as HTMLButtonElement;
const steerInput = document.getElementById("steer-input") as HTMLTextAreaElement;
const btnTakeOver = document.getElementById("btn-take-over") as HTMLButtonElement;
const composerCount = document.getElementById("composer-count") as HTMLElement;
const panelNotice = document.getElementById("panel-notice") as HTMLElement;
const deleteDialog = document.getElementById("delete-dialog") as HTMLDialogElement;
const deleteDialogTitle = document.getElementById("delete-dialog-title") as HTMLElement;

// Sessions state
const sessions: Map<string, SessionData> = new Map();

// One of 256 hues, spread over the colour wheel, so each chat gets its own user avatar colour
const randomUserHue = (): number => Math.round((Math.floor(Math.random() * 256) * 360) / 256);
let activeRunId = "run_1";
let sessionCounter = 1;

const SEND_ICON = getMaterial3Svg("send", 16);
const STOP_ICON = getMaterial3Svg("stop", 16);

// Initialize with clean primary session (no fake messages or fake action cards)
sessions.set("run_1", {
  runId: "run_1",
  name: "Task 1",
  isPinned: false,
  state: "READY",
  epoch: 0,
  tabId: null,
  messages: [],
  actions: [],
  verifiedCount: 0,
  userHue: randomUserHue(),
});

// ---------- Mood background ----------
// Four drifting color fields whose palette follows what the agent is doing.
// CSS registers --c1..--c4 as <color>, so every change blends smoothly.
type Mood = "warming" | "idle" | "thinking" | "clicking" | "browsing" | "success" | "error" | "paused";

const MOODS: Record<Mood, { hues: number[]; sat: number; glow: number }> = {
  warming: { hues: [205, 225, 245, 190], sat: 35, glow: 0.44 },
  idle: { hues: [220, 255, 190, 280], sat: 55, glow: 0.52 },
  thinking: { hues: [270, 300, 235, 320], sat: 70, glow: 0.69 },
  clicking: { hues: [25, 45, 345, 12], sat: 75, glow: 0.69 },
  browsing: { hues: [180, 160, 200, 140], sat: 65, glow: 0.64 },
  success: { hues: [140, 160, 120, 175], sat: 60, glow: 0.64 },
  error: { hues: [0, 350, 18, 330], sat: 70, glow: 0.69 },
  paused: { hues: [215, 230, 200, 245], sat: 18, glow: 0.39 },
};

const aura = document.getElementById("aura") as HTMLElement;
let currentMood: Mood = "warming";
let moodRevertTimer: number | undefined;

function paintMood(): void {
  const { hues, sat, glow } = MOODS[currentMood];
  // Shuffle which corner gets which hue and jitter each one, so no two paints look the same
  const shuffled = [...hues].sort(() => Math.random() - 0.5);
  shuffled.forEach((hue, i) => {
    const h = (hue + (Math.random() * 24 - 12) + 360) % 360;
    const l = 34 + Math.random() * 14;
    aura.style.setProperty(`--c${i + 1}`, `hsl(${h.toFixed(0)} ${sat}% ${l.toFixed(0)}%)`);
  });
  aura.style.setProperty("--glow", String(glow));
}

// Icon shown next to "Relay" on the message being worked on, so you can see what it is doing
const MOOD_ICONS: Record<Mood, { icon: Material3IconName; label: string }> = {
  warming: { icon: "hourglass_top", label: "Warming up" },
  idle: { icon: "auto_awesome", label: "Thinking" },
  thinking: { icon: "auto_awesome", label: "Thinking" },
  clicking: { icon: "touch_app", label: "Interacting with the page" },
  browsing: { icon: "language", label: "Browsing" },
  success: { icon: "check_circle", label: "Step verified" },
  error: { icon: "error", label: "Something failed" },
  paused: { icon: "pause_circle", label: "Paused" },
};

function updatePendingStateIcon(): void {
  const slot = chatMessagesContainer.querySelector(".msg.pending .msg-state") as HTMLElement | null;
  if (!slot) return;
  const { icon, label } = MOOD_ICONS[currentMood];
  slot.className = `msg-state state-${currentMood}`;
  slot.innerHTML = getMaterial3Svg(icon, 13);
  slot.title = label;
}

function setMood(mood: Mood, revertAfterMs?: number): void {
  if (moodRevertTimer !== undefined) window.clearTimeout(moodRevertTimer);
  moodRevertTimer = undefined;
  if (mood !== currentMood) {
    currentMood = mood;
    paintMood();
  }
  updatePendingStateIcon();
  if (revertAfterMs) {
    moodRevertTimer = window.setTimeout(() => setMood(restingMood()), revertAfterMs);
  }
}

// The mood to settle back into after a short flash (success / error)
function restingMood(): Mood {
  const current = sessions.get(activeRunId);
  if (current?.state === "PAUSED" || current?.state === "MANUAL_TAKEOVER") return "paused";
  return current?.messages.some((m) => m.pending) ? "thinking" : "idle";
}

function moodForAction(type: string): Mood {
  return ["browser_click", "browser_type", "browser_upload"].includes(type) ? "clicking" : "browsing";
}

paintMood();
// Slowly re-roll the colors within the current mood so the background keeps living
window.setInterval(paintMood, 9000);

// Initialize button icons with Material 3
btnNewSession.innerHTML = getMaterial3Svg("add", 16);
btnPause.innerHTML = `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
btnStop.innerHTML = `${getMaterial3Svg("stop", 12)} <span>STOP</span>`;
btnRestart.innerHTML = `${getMaterial3Svg("restart_alt", 12)} <span>RESTART</span>`;
btnSteer.innerHTML = SEND_ICON;
btnTakeOver.innerHTML = `${getMaterial3Svg("touch_app", 12)} <span>TAKE OVER</span>`;

renderTabs();
updateActiveSessionDisplay();
steerInput.focus(); // ready to type right after the hotkey opens the panel

// Query bridge status from background
const refreshBridgeStatus = () => chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, (response) => {
  if (response?.connected) {
    statusText.textContent = "Connected";
    statusBadge.className = "status-badge connected";
    statusBadge.title = "Connected";
  } else {
    statusText.textContent = "Offline";
    statusBadge.className = "status-badge disconnected";
    statusBadge.title = "Offline";
  }
});
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 5000);

// Warm up NVIDIA NIM as soon as the panel opens and show whether it's ready
function setNimStatus(state: "warming" | "ready" | "error", text: string, title = text): void {
  modelNameLabel.className = `model nim-${state}`;
  modelNameLabel.title = title === text ? text : `${text} — ${title}`;
  modelNameLabel.setAttribute("aria-label", text);
}

function shortModelName(model: string): string {
  return model.split("/").pop() || model;
}

setNimStatus("warming", "NIM warming up…");
chrome.runtime.sendMessage({ type: "WARM_NIM" }, (response) => {
  if (currentMood === "warming") setMood(response?.state === "ready" ? "idle" : "error", response?.state === "ready" ? undefined : 2500);
  if (response?.state === "ready") {
    setNimStatus("ready", `NIM ready · ${shortModelName(response.model)}`, `Answered in ${response.ms} ms`);
  } else if (response?.state === "no_key") {
    setNimStatus("error", "NIM: add API key", "Click to open settings");
    modelNameLabel.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    setNimStatus("error", `NIM ${response?.detail || "unreachable"}`);
  }
});

// Render session tabs
function renderTabs(): void {
  tabsList.innerHTML = "";
  for (const session of sessions.values()) {
    const tabEl = document.createElement("div");
    tabEl.className = `session-tab ${session.runId === activeRunId ? "active" : ""}`;
    tabEl.title = `${session.name} (${session.isPinned ? "Pinned" : "Unpinned"})`;
    tabEl.role = "tab";
    tabEl.tabIndex = session.runId === activeRunId ? 0 : -1;
    tabEl.setAttribute("aria-selected", String(session.runId === activeRunId));
    tabEl.onclick = () => switchSession(session.runId);
    tabEl.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        switchSession(session.runId);
      }
    };

    const titleSpan = document.createElement("span");
    titleSpan.textContent = session.name;

    const pinIndicator = document.createElement("button");
    pinIndicator.type = "button";
    pinIndicator.className = "tab-pin-indicator";
    pinIndicator.innerHTML = session.isPinned
      ? getMaterial3Svg("push_pin", 12)
      : getMaterial3Svg("push_pin_outline", 12);
    pinIndicator.title = session.isPinned ? "Pinned" : "Unpinned";
    pinIndicator.setAttribute(
      "aria-label",
      session.isPinned ? `Unpin ${session.name}` : `Pin ${session.name}`
    );
    pinIndicator.onclick = (e) => {
      e.stopPropagation();
      togglePin(session.runId);
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.innerHTML = getMaterial3Svg("close", 12);
    closeBtn.title = session.isPinned
      ? "Pinned session (unpin first to close)"
      : "Close session";
    closeBtn.setAttribute("aria-label", `Close ${session.name}`);
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeSession(session.runId);
    };

    tabEl.appendChild(pinIndicator);
    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabsList.appendChild(tabEl);
  }
}

function switchSession(runId: string): void {
  if (!sessions.has(runId)) return;
  activeRunId = runId;
  const current = sessions.get(runId);
  if (current?.tabId && typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.update) {
    try {
      chrome.tabs.update(current.tabId, { active: true });
    } catch {
      // Tab might have been closed
    }
  }
  renderTabs();
  updateActiveSessionDisplay();
}

function updateActiveSessionDisplay(): void {
  const current = sessions.get(activeRunId);
  if (!current) return;

  sessionNameText.textContent = current.name;
  tabStatusText.textContent = current.tabId ? `Attached to tab ${current.tabId}` : "No tab attached";

  if (current.isPinned) {
    sessionPinStatus.innerHTML = `${getMaterial3Svg("push_pin", 12)} <span>Pinned</span>`;
    sessionPinStatus.style.borderColor = "var(--cyan-accent)";
    btnTogglePin.textContent = "Unpin";
  } else {
    sessionPinStatus.innerHTML = `${getMaterial3Svg("push_pin_outline", 12)} <span>Unpinned</span>`;
    sessionPinStatus.style.borderColor = "var(--border)";
    btnTogglePin.textContent = "Pin";
  }

  sessionActionStats.innerHTML = `${getMaterial3Svg("bolt", 12)} <span>${current.verifiedCount} verified</span>`;
  liveActionText.textContent = `${current.state}`;
  updateExecutionControls(current);

  renderChatMessages(current);
  renderActivityFeed(current);
}

function renderChatMessages(session: SessionData): void {
  chatMessagesContainer.innerHTML = "";

  if (session.messages.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.innerHTML = `<p>Ask anything about this page.</p>`;
    chatMessagesContainer.appendChild(hint);
  }

  for (const msg of session.messages) {
    const entry = document.createElement("div");
    entry.className = `msg ${msg.role}${msg.pending ? " pending" : ""}`;
    const avatar = document.createElement("span");
    avatar.className = "msg-avatar";
    avatar.innerHTML = getMaterial3Svg(msg.role === "agent" ? "smart_toy" : "person", 15);
    avatar.setAttribute("aria-hidden", "true");
    if (msg.role === "user") avatar.style.setProperty("--user-hue", String(session.userHue));

    const column = document.createElement("div");
    column.className = "msg-column";

    if (msg.role === "agent") {
      const label = document.createElement("span");
      label.className = "msg-label";
      label.textContent = "Relay";
      const state = document.createElement("span");
      // Live icon while working; a quiet check / error mark once finished
      if (msg.pending) {
        state.className = "msg-state";
      } else {
        const done = msg.failed ? MOOD_ICONS.error : MOOD_ICONS.success;
        state.className = `msg-state ${msg.failed ? "state-error" : "state-done"}`;
        state.innerHTML = getMaterial3Svg(done.icon, 13);
        state.title = msg.failed ? done.label : "Done";
      }
      label.appendChild(state);
      column.appendChild(label);
    }

    const body = document.createElement("div");
    body.className = "msg-body";
    if (msg.pending && !msg.text) {
      body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    } else {
      if (msg.role === "agent") {
        body.innerHTML = renderMarkdownLite(msg.text);
      } else {
        body.textContent = msg.text;
      }
    }
    column.appendChild(body);
    if (msg.confirm) column.appendChild(buildConfirmRow(session, msg));

    entry.appendChild(avatar);
    entry.appendChild(column);
    chatMessagesContainer.appendChild(entry);
  }
  updateComposerState();
  updatePendingStateIcon();

  timelineContainer.scrollTop = timelineContainer.scrollHeight;
}

// Minimal Markdown for agent replies: bold, italics, inline code, links, bullet and
// numbered lists, paragraphs. Everything is HTML-escaped first, so page text can't inject markup.
function renderMarkdownLite(text: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((bullet || numbered)![1])}</li>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else if (list && /^\s+/.test(line) && out.length && out[out.length - 1].startsWith("<li>")) {
      // Indented continuation of the previous list item
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}

// Buttons for an extension op. The click is the user gesture chrome.management needs,
// so the op runs right here and the result goes back to the background run.
function buildConfirmRow(session: SessionData, msg: ChatMessage): HTMLElement {
  const { requestId, op, id, name } = msg.confirm!;
  const row = document.createElement("div");
  row.className = "confirm-row";
  const verb = op === "uninstall" ? "Remove" : op === "disable" ? "Disable" : "Enable";

  const finish = (text: string, outcome: string, failed = false) => {
    msg.confirm = undefined;
    msg.text = text;
    msg.failed = failed;
    renderChatMessages(session);
    chrome.runtime.sendMessage({ type: "EXTENSION_CONFIRM_RESULT", requestId, outcome });
  };

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = `confirm-btn primary${op === "uninstall" ? " danger" : ""}`;
  yes.innerHTML = `${getMaterial3Svg(op === "uninstall" ? "cancel" : op === "disable" ? "pause_circle" : "check_circle", 14)} <span>${verb} ${name}</span>`;
  yes.onclick = async () => {
    yes.disabled = no.disabled = true;
    try {
      if (op === "uninstall") {
        await chrome.management.uninstall(id, { showConfirmDialog: false });
        const stillThere = (await chrome.management.getAll()).some((e) => e.id === id);
        if (stillThere) return finish(`"${name}" is still installed.`, `CANCELLED: "${name}" was not removed`, true);
        finish(`Removed "${name}".`, `SUCCESS: "${name}" was uninstalled`);
      } else {
        await chrome.management.setEnabled(id, op === "enable");
        finish(`${verb}d "${name}".`, `SUCCESS: "${name}" is now ${op}d`);
      }
    } catch (err: any) {
      finish(`Couldn't ${op} "${name}": ${err?.message || err}`, `FAILED: ${err?.message || err}`, true);
    }
  };

  const no = document.createElement("button");
  no.type = "button";
  no.className = "confirm-btn";
  no.textContent = "Keep";
  no.onclick = () => finish(`Kept "${name}".`, `CANCELLED: you chose to keep "${name}"`);

  row.appendChild(yes);
  row.appendChild(no);
  return row;
}

function renderActivityFeed(session: SessionData): void {
  activityFeed.innerHTML = "";
  const shouldShowBox = session.actions.length > 0 || session.state !== "READY";
  liveActionBox.style.display = shouldShowBox ? "block" : "none";

  for (const action of session.actions) {
    const card = createActionCardElement(action);
    activityFeed.appendChild(card);
  }
  activityFeed.scrollTop = activityFeed.scrollHeight;
  timelineContainer.scrollTop = timelineContainer.scrollHeight;
}

function createActionCardElement(action: ActionItem): HTMLElement {
  const card = document.createElement("div");
  card.className = `action-card action-${action.type} ${action.status}`;
  card.id = `action-card-${action.id}`;

  const header = document.createElement("div");
  header.className = "action-card-header";

  const badge = document.createElement("span");
  const badgeInfo = getBadgeInfo(action.type);
  badge.className = `action-type-badge ${badgeInfo.className}`;
  badge.innerHTML = `${getMaterial3Svg(badgeInfo.icon, 12)} <span>${badgeInfo.label}</span>`;

  const targetDesc = document.createElement("span");
  targetDesc.className = "action-target-desc";
  targetDesc.textContent = action.target || action.type;
  targetDesc.title = action.target || action.type;

  const durationChip = document.createElement("span");
  durationChip.className = "action-duration-chip";
  if (action.status === "active") {
    durationChip.textContent = "Running...";
  } else if (action.durationMs !== undefined) {
    durationChip.textContent = `${action.durationMs}ms`;
  } else {
    durationChip.textContent = "";
  }

  const statusPill = document.createElement("span");
  if (action.status === "active") {
    statusPill.className = "action-status-pill pill-active";
    statusPill.innerHTML = `${getMaterial3Svg("bolt", 11)} <span>Running</span>`;
  } else if (action.status === "success") {
    statusPill.className = "action-status-pill pill-verified";
    statusPill.innerHTML = `${getMaterial3Svg("check_circle", 11)} <span>Verified</span>`;
  } else {
    statusPill.className = "action-status-pill pill-failed";
    statusPill.innerHTML = `${getMaterial3Svg("cancel", 11)} <span>Failed</span>`;
  }

  header.appendChild(badge);
  header.appendChild(targetDesc);
  if (durationChip.textContent) header.appendChild(durationChip);
  header.appendChild(statusPill);
  card.appendChild(header);

  if (action.details) {
    const details = document.createElement("div");
    details.className = "action-card-details";
    details.textContent = action.details;
    card.appendChild(details);
  }

  return card;
}

function getBadgeInfo(type: string): { label: string; icon: Material3IconName; className: string } {
  switch (type) {
    case "browser_navigate":
      return { label: "NAVIGATE", icon: "language", className: "badge-navigate" };
    case "browser_click":
      return { label: "CLICK", icon: "touch_app", className: "badge-click" };
    case "browser_type":
      return { label: "TYPE", icon: "keyboard", className: "badge-type" };
    case "browser_scroll":
      return { label: "SCROLL", icon: "swap_vert", className: "badge-scroll" };
    case "browser_download":
      return { label: "DOWNLOAD", icon: "download", className: "badge-download" };
    case "browser_upload":
      return { label: "UPLOAD", icon: "upload", className: "badge-upload" };
    case "browser_verify":
      return { label: "VERIFY", icon: "visibility", className: "badge-verify" };
    case "browser_screenshot":
    case "browser_snapshot":
      return { label: "SNAPSHOT", icon: "photo_camera", className: "badge-screenshot" };
    default:
      return { label: "SYSTEM", icon: "terminal", className: "badge-system" };
  }
}

function formatActionTarget(action: any): string {
  if (!action) return "unknown";
  switch (action.type) {
    case "browser_navigate":
      return action.url || "URL";
    case "browser_click":
      if (action.locator?.selector) return action.locator.selector;
      if (action.locator?.name) return `"${action.locator.name}"`;
      if (action.locator?.point) return `(${action.locator.point.x}, ${action.locator.point.y})`;
      return "element";
    case "browser_type":
      const masked = action.text ? "••••••" : "";
      const sel = action.locator?.selector || action.locator?.name || "field";
      return `${sel} -> "${masked}"`;
    case "browser_scroll":
      return `${action.scroll_direction || "down"} (${action.scroll_amount || 400}px)`;
    case "browser_download":
      return action.download_path || action.url || "download";
    case "browser_upload":
      const count = action.file_paths?.length || 0;
      return `${action.locator?.selector || 'input[type="file"]'} (${count} file${count === 1 ? "" : "s"})`;
    case "browser_verify":
      return action.locator?.selector || `text: "${action.text || ""}"`;
    default:
      return action.type;
  }
}

// Create new session tab inside sidepanel (never opens a new Chrome browser tab)
function createNewSession(name?: string): void {
  sessionCounter++;
  const runId = `run_${Date.now()}`;
  const sessionName = name || `Task ${sessionCounter}`;

  const newSession: SessionData = {
    runId,
    name: sessionName,
    isPinned: false,
    state: "READY",
    epoch: 0,
    tabId: null,
    messages: [],
    actions: [],
    verifiedCount: 0,
    userHue: randomUserHue(),
  };

  sessions.set(runId, newSession);
  activeRunId = runId;
  renderTabs();
  updateActiveSessionDisplay();

  chrome.runtime.sendMessage({
    type: "SESSION_COMMAND",
    event: "session.create",
    run_id: runId,
    payload: { name: sessionName },
  });
}

function closeSession(runId: string): void {
  const session = sessions.get(runId);
  if (!session) return;

  if (session.isPinned) {
    showNotice(`Unpin ${session.name} before closing it.`);
    return;
  }

  deleteSession(runId, true);
}

function requestSessionDelete(runId: string): void {
  const session = sessions.get(runId);
  if (!session) return;
  if (session.isPinned) {
    showNotice(`Unpin ${session.name} before deleting it.`);
    return;
  }
  deleteDialog.dataset.runId = runId;
  deleteDialogTitle.textContent = `Delete ${session.name}?`;
  deleteDialog.showModal();
}

function deleteSession(runId: string, fromClose = false): void {
  sessions.delete(runId);

  chrome.runtime.sendMessage({
    type: "SESSION_COMMAND",
    event: fromClose ? "session.close" : "session.delete",
    run_id: runId,
  });

  if (sessions.size === 0) {
    sessionCounter = 0;
    createNewSession("Task 1");
  } else if (activeRunId === runId) {
    const firstRemaining = sessions.keys().next().value;
    if (firstRemaining) {
      activeRunId = firstRemaining;
    }
  }

  renderTabs();
  updateActiveSessionDisplay();
}

function togglePin(runId: string): void {
  const session = sessions.get(runId);
  if (!session) return;

  session.isPinned = !session.isPinned;
  renderTabs();
  updateActiveSessionDisplay();

  chrome.runtime.sendMessage({
    type: "SESSION_COMMAND",
    event: "session.pin",
    run_id: runId,
    payload: { is_pinned: session.isPinned },
  });
}

// Event Listeners
// "New chat" replaces the current conversation (session tabs are hidden)
btnNewSession.addEventListener("click", () => {
  const previous = sessions.get(activeRunId);
  createNewSession();
  if (previous && !previous.isPinned) deleteSession(previous.runId, true);
});
btnTogglePin.addEventListener("click", () => togglePin(activeRunId));
btnDeleteSession.addEventListener("click", () => requestSessionDelete(activeRunId));
sessionPinStatus.addEventListener("click", () => togglePin(activeRunId));
deleteDialog.addEventListener("close", () => {
  if (deleteDialog.returnValue !== "confirm") return;
  const runId = deleteDialog.dataset.runId;
  if (runId) deleteSession(runId);
});

btnAttachTab.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ATTACH_ACTIVE_TAB" }, (response) => {
    const current = sessions.get(activeRunId);
    if (response?.attached && current) {
      current.tabId = response.tabId;
      tabStatusText.textContent = `Attached to tab ${response.tabId}`;
      showNotice(`Attached ${current.name} to tab ${response.tabId}.`);
    } else {
      tabStatusText.textContent = "Attachment failed";
      showNotice("Could not attach the active tab.");
    }
  });
});

btnPause.addEventListener("click", () => {
  const current = sessions.get(activeRunId);
  if (!current) return;
  const shouldResume = current.state === "PAUSED";
  current.state = shouldResume ? "RUNNING" : "PAUSED";
  dispatchControl(shouldResume ? "resume" : "pause");
  liveActionBox.style.display = "block";
  liveActionText.textContent = shouldResume ? "RUNNING · Agent resumed" : "PAUSED · Awaiting resume";
  liveDot.style.color = shouldResume ? "var(--cyan-accent)" : "var(--magenta-steer)";
  updateExecutionControls(current);
});

btnStop.addEventListener("click", () => {
  const current = sessions.get(activeRunId);
  if (!current) return;
  current.state = "STOPPED";
  dispatchControl("stop");
  liveActionBox.style.display = "block";
  liveActionText.textContent = "STOPPED · Execution halted";
  liveDot.style.color = "var(--red-error)";
  updateExecutionControls(current);
});

btnRestart.addEventListener("click", () => {
  const current = sessions.get(activeRunId);
  if (current) current.state = "READY";
  dispatchControl("restart");
  liveActionText.textContent = "READY";
  liveDot.style.color = "var(--cyan-accent)";
  if (current) {
    updateExecutionControls(current);
    renderActivityFeed(current);
  }
});

function submitChatMessage(): void {
  const text = steerInput.value.trim();
  if (!text) return;

  const current = sessions.get(activeRunId);
  if (!current) return;

  steerInput.value = "";
  updateComposerState();

  const historySnapshot = current.messages
    .filter((m) => !m.pending)
    .map((m) => ({ role: m.role, text: m.text }));

  current.messages.push({
    id: `msg_u_${Date.now()}`,
    role: "user",
    text,
  });

  current.messages.push({
    id: `msg_a_${Date.now()}`,
    role: "agent",
    text: "",
    pending: true,
  });

  renderChatMessages(current);
  setMood("thinking");

  chrome.runtime.sendMessage({
    type: "DISPATCH_CONTROL",
    command: "steer",
    run_id: current.runId,
    epoch: current.epoch,
    tab_id: current.tabId,
    instruction: text,
    history: [...historySnapshot, { role: "user", text }],
  });
}

btnSteer.addEventListener("click", () => {
  const current = sessions.get(activeRunId);
  const pending = current?.messages.find((m) => m.pending);
  if (current && pending) {
    dispatchControl("stop");
    pending.pending = false;
    pending.failed = true;
    pending.text = "Stopped.";
    renderChatMessages(current);
    setMood("idle");
    return;
  }
  submitChatMessage();
});
steerInput.addEventListener("input", () => updateComposerState());
steerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitChatMessage();
  }
});

btnTakeOver.addEventListener("click", () => {
  const current = sessions.get(activeRunId);
  if (!current) return;
  const shouldReturn = current.state === "MANUAL_TAKEOVER";
  current.state = shouldReturn ? "READY" : "MANUAL_TAKEOVER";
  dispatchControl(shouldReturn ? "return_control" : "take_over");
  liveActionBox.style.display = "block";
  liveActionText.textContent = shouldReturn ? "READY · Control returned" : "MANUAL TAKEOVER · Agent paused";
  liveDot.style.color = shouldReturn ? "var(--cyan-accent)" : "var(--magenta-steer)";
  updateExecutionControls(current);
});

function updateComposerState(): void {
  const length = steerInput.value.length;
  const isWaiting = !!sessions.get(activeRunId)?.messages.some((m) => m.pending);
  btnSteer.innerHTML = isWaiting ? STOP_ICON : SEND_ICON;
  btnSteer.setAttribute("aria-label", isWaiting ? "Stop" : "Send");
  btnSteer.title = isWaiting ? "Stop" : "Send";
  btnSteer.classList.toggle("is-stop", isWaiting);
  btnSteer.disabled = !isWaiting && steerInput.value.trim().length === 0;
  composerCount.textContent = `${length} / 4000`;
  steerInput.style.height = "auto";
  steerInput.style.height = `${Math.min(steerInput.scrollHeight, 110)}px`;
}

function updateExecutionControls(session: SessionData): void {
  const isPaused = session.state === "PAUSED";
  const isManual = session.state === "MANUAL_TAKEOVER";
  btnPause.innerHTML = isPaused
    ? `${getMaterial3Svg("restart_alt", 12)} <span>RESUME</span>`
    : `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
  btnPause.classList.toggle("is-active", isPaused);
  btnPause.setAttribute("aria-pressed", String(isPaused));
  btnTakeOver.innerHTML = isManual
    ? `${getMaterial3Svg("restart_alt", 12)} <span>RETURN</span>`
    : `${getMaterial3Svg("touch_app", 12)} <span>TAKE OVER</span>`;
  btnTakeOver.classList.toggle("is-active", isManual);
  btnTakeOver.setAttribute("aria-pressed", String(isManual));
}

let noticeTimer: number | undefined;

function showNotice(message: string): void {
  panelNotice.textContent = message;
  panelNotice.classList.add("is-visible");
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => panelNotice.classList.remove("is-visible"), 2600);
}

function dispatchControl(command: string, instruction?: string): void {
  const current = sessions.get(activeRunId);
  if (!current) return;

  chrome.runtime.sendMessage({
    type: "DISPATCH_CONTROL",
    command,
    run_id: current.runId,
    epoch: current.epoch,
    instruction,
  });
}

// Listen for broadcast events from background
chrome.runtime.onMessage.addListener((msg) => {
  const targetRunId = msg.run_id || activeRunId;
  const session = sessions.get(targetRunId);
  if (!session) return;

  if (msg.event === "chat.response" && msg.payload) {
    const replyText = String(msg.payload.text || "");
    const model = String(msg.payload.model || "");
    if (model && model !== "local" && model !== "error") {
      setNimStatus("ready", `NIM ready · ${shortModelName(model)}`);
    }

    // Each step's text replaces the working reply; it stays "working" until run.completed
    const pendingIdx = session.messages.findIndex((m) => m.pending);
    const last = session.messages[session.messages.length - 1];
    const confirm = msg.payload.confirm;
    if (pendingIdx !== -1) {
      session.messages[pendingIdx].text = replyText;
      session.messages[pendingIdx].failed = model === "error";
      session.messages[pendingIdx].confirm = confirm;
    } else if (last && last.role === "agent") {
      last.text = replyText;
      last.failed = model === "error";
      last.confirm = confirm;
    } else {
      session.messages.push({ id: `msg_a_${Date.now()}`, role: "agent", text: replyText, pending: true, confirm });
    }

    if (targetRunId === activeRunId) {
      renderChatMessages(session);
      setMood(model === "error" ? "error" : restingMood(), model === "error" ? 2500 : undefined);
    }
  } else if (msg.event === "run.completed") {
    for (const m of session.messages) m.pending = false;
    if (targetRunId === activeRunId) {
      renderChatMessages(session);
      setMood(restingMood());
    }
  } else if (msg.event === "run.state_changed" && msg.payload) {
    session.state = msg.payload.new_state;
    if (msg.epoch !== undefined) session.epoch = msg.epoch;
    if (targetRunId === activeRunId) {
      liveActionText.textContent = `${session.state}`;
      updateExecutionControls(session);
      setMood(restingMood());
    }
  } else if (msg.event === "action.started" && msg.action) {
    const actionId = msg.idempotency_key || `act_${Date.now()}`;
    const newAction: ActionItem = {
      id: actionId,
      type: msg.action.type,
      target: formatActionTarget(msg.action),
      startTime: Date.now(),
      status: "active",
    };
    session.actions.push(newAction);

    if (targetRunId === activeRunId) {
      liveDot.style.color = "var(--cyan-accent)";
      liveActionText.textContent = `Running: ${newAction.target}`;
      setMood(moodForAction(newAction.type));
      renderActivityFeed(session);
    }
  } else if (msg.event === "action.finished") {
    const lastActive = [...session.actions].reverse().find((a) => a.status === "active");
    if (lastActive) {
      lastActive.status = "success";
      lastActive.endTime = Date.now();
      lastActive.durationMs = lastActive.endTime - lastActive.startTime;
      if (msg.payload?.uploaded_files) {
        lastActive.details = `Uploaded: ${msg.payload.uploaded_files.join(", ")}`;
      } else if (msg.payload?.download_id) {
        lastActive.details = `Downloaded file ID: ${msg.payload.download_id}`;
      } else if (msg.payload?.outcome_summary) {
        lastActive.details = msg.payload.outcome_summary;
      }
    }
    session.verifiedCount++;

    if (targetRunId === activeRunId) {
      liveDot.style.color = "var(--green-ok)";
      sessionActionStats.innerHTML = `${getMaterial3Svg("bolt", 12)} <span>${session.verifiedCount} verified</span>`;
      liveActionText.textContent = "Verified";
      setMood("success", 1400);
      renderActivityFeed(session);
    }
  } else if (msg.event === "action.failed") {
    const lastActive = [...session.actions].reverse().find((a) => a.status === "active");
    if (lastActive) {
      lastActive.status = "failed";
      lastActive.endTime = Date.now();
      lastActive.durationMs = lastActive.endTime - lastActive.startTime;
      lastActive.details = msg.payload?.error || "Execution failed";
    }

    if (targetRunId === activeRunId) {
      liveDot.style.color = "var(--red-error)";
      liveActionText.textContent = `Failed: ${msg.payload?.error || "Error"}`;
      setMood("error", 2500);
      renderActivityFeed(session);
    }
  }
});
