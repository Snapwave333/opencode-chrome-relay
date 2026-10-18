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
let activeRunId = "run_1";
let sessionCounter = 1;

modelNameLabel.textContent = "NVIDIA NIM";

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
});

// Initialize button icons with Material 3
btnNewSession.innerHTML = `${getMaterial3Svg("add", 12)} <span>New</span>`;
btnPause.innerHTML = `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
btnStop.innerHTML = `${getMaterial3Svg("stop", 12)} <span>STOP</span>`;
btnRestart.innerHTML = `${getMaterial3Svg("restart_alt", 12)} <span>RESTART</span>`;
btnSteer.innerHTML = `${getMaterial3Svg("send", 12)} <span>SEND</span>`;
btnTakeOver.innerHTML = `${getMaterial3Svg("touch_app", 12)} <span>TAKE OVER</span>`;

renderTabs();
updateActiveSessionDisplay();

// Query bridge status from background
chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, (response) => {
  if (response?.connected) {
    statusText.textContent = "Connected";
    statusBadge.className = "status-badge connected";
  } else {
    statusText.textContent = "Offline";
    statusBadge.className = "status-badge disconnected";
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
    const emptyHint = document.createElement("div");
    emptyHint.className = "chat-empty-state";

    const mark = document.createElement("span");
    mark.className = "empty-state-mark";
    mark.innerHTML = getMaterial3Svg("explore", 24);

    const heading = document.createElement("h1");
    heading.textContent = "Ready when the page is.";

    const copy = document.createElement("p");
    copy.textContent = "Attach the active tab, then describe the outcome you want. Relay will show each browser action as it happens.";

    const suggestions = document.createElement("div");
    suggestions.className = "empty-suggestions";
    for (const suggestion of [
      "Summarize this page",
      "Find the primary action",
      "Check this form for issues",
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-chip";
      button.textContent = suggestion;
      button.onclick = () => {
        steerInput.value = suggestion;
        updateComposerState();
        steerInput.focus();
      };
      suggestions.appendChild(button);
    }

    emptyHint.appendChild(mark);
    emptyHint.appendChild(heading);
    emptyHint.appendChild(copy);
    emptyHint.appendChild(suggestions);
    chatMessagesContainer.appendChild(emptyHint);
    return;
  }

  for (const msg of session.messages) {
    const entry = document.createElement("div");
    entry.className =
      msg.role === "user"
        ? "timeline-entry user steer"
        : `timeline-entry agent${msg.pending ? " pending" : ""}`;

    const roleTag = document.createElement("span");
    roleTag.className = "role-tag";
    roleTag.textContent = msg.role === "user" ? "USER · STEER (USER)" : "AGENT";

    const content = document.createElement("p");
    content.className = "content-text";
    content.textContent = msg.text;

    entry.appendChild(roleTag);
    entry.appendChild(content);
    chatMessagesContainer.appendChild(entry);
  }

  timelineContainer.scrollTop = timelineContainer.scrollHeight;
}

const MAX_TRACKED_ACTIONS = 200;

function findActiveAction(session: SessionData, idempotencyKey?: string): ActionItem | undefined {
  const byKey = idempotencyKey ? session.actions.find((a) => a.id === idempotencyKey) : undefined;
  return byKey ?? [...session.actions].reverse().find((a) => a.status === "active");
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
btnNewSession.addEventListener("click", () => createNewSession());
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
    text: "Thinking...",
    pending: true,
  });

  renderChatMessages(current);

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

btnSteer.addEventListener("click", () => submitChatMessage());
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
  btnSteer.disabled = steerInput.value.trim().length === 0;
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
      const shortModel = model.split("/").pop() || model;
      modelNameLabel.textContent = `NVIDIA NIM · ${shortModel}`;
    }

    const pendingIdx = session.messages.findIndex((m) => m.pending);
    if (pendingIdx !== -1) {
      session.messages[pendingIdx] = {
        id: session.messages[pendingIdx].id,
        role: "agent",
        text: replyText,
        pending: false,
      };
    } else if (
      session.messages.length > 0 &&
      session.messages[session.messages.length - 1].role === "agent"
    ) {
      session.messages[session.messages.length - 1].text = replyText;
    } else {
      session.messages.push({
        id: `msg_a_${Date.now()}`,
        role: "agent",
        text: replyText,
      });
    }

    if (targetRunId === activeRunId) {
      renderChatMessages(session);
    }
  } else if (msg.event === "run.state_changed" && msg.payload) {
    session.state = msg.payload.new_state;
    if (msg.epoch !== undefined) session.epoch = msg.epoch;
    if (targetRunId === activeRunId) {
      liveActionText.textContent = `${session.state}`;
      updateExecutionControls(session);
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
    if (session.actions.length > MAX_TRACKED_ACTIONS) {
      session.actions.splice(0, session.actions.length - MAX_TRACKED_ACTIONS);
    }

    if (targetRunId === activeRunId) {
      liveDot.style.color = "var(--cyan-accent)";
      liveActionText.textContent = `Running: ${newAction.target}`;
      renderActivityFeed(session);
    }
  } else if (msg.event === "action.finished") {
    const actionSucceeded = msg.payload?.success !== false;
    const lastActive = findActiveAction(session, msg.idempotency_key);
    if (lastActive) {
      lastActive.status = actionSucceeded ? "success" : "failed";
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
    if (actionSucceeded) session.verifiedCount++;

    if (targetRunId === activeRunId) {
      liveDot.style.color = actionSucceeded ? "var(--green-ok)" : "var(--red-error)";
      sessionActionStats.innerHTML = `${getMaterial3Svg("bolt", 12)} <span>${session.verifiedCount} verified</span>`;
      liveActionText.textContent = actionSucceeded ? "Verified" : `Failed: ${msg.payload?.outcome_summary || "Not confirmed"}`;
      renderActivityFeed(session);
    }
  } else if (msg.event === "action.failed") {
    const lastActive = findActiveAction(session, msg.idempotency_key);
    if (lastActive) {
      lastActive.status = "failed";
      lastActive.endTime = Date.now();
      lastActive.durationMs = lastActive.endTime - lastActive.startTime;
      lastActive.details = msg.payload?.error || "Execution failed";
    }

    if (targetRunId === activeRunId) {
      liveDot.style.color = "var(--red-error)";
      liveActionText.textContent = `Failed: ${msg.payload?.error || "Error"}`;
      renderActivityFeed(session);
    }
  }
});
