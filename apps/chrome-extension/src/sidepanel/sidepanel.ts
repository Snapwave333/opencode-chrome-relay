// Side panel UI Logic with Multi-Session Tabbed Interface & Pinning
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

interface SessionData {
  runId: string;
  name: string;
  isPinned: boolean;
  state: string;
  epoch: number;
  tabId: number | null;
  actions: ActionItem[];
  verifiedCount: number;
}

const statusBadge = document.getElementById("bridge-status-badge") as HTMLElement;
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
const liveDot = document.getElementById("live-dot") as HTMLElement;
const liveActionText = document.getElementById("live-action-text") as HTMLElement;
const activityFeed = document.getElementById("activity-feed") as HTMLDivElement;
const timelineContainer = document.getElementById("timeline") as HTMLElement;

const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnRestart = document.getElementById("btn-restart") as HTMLButtonElement;
const btnSteer = document.getElementById("btn-steer-send") as HTMLButtonElement;
const steerInput = document.getElementById("steer-input") as HTMLInputElement;
const btnTakeOver = document.getElementById("btn-take-over") as HTMLButtonElement;

// Sessions state
const sessions: Map<string, SessionData> = new Map();
let activeRunId = "run_1";
let sessionCounter = 1;

// Default NVIDIA NIM model
modelNameLabel.textContent = "NVIDIA NIM (Free)";

// Initialize with primary default session
sessions.set("run_1", {
  runId: "run_1",
  name: "Task 1",
  isPinned: false,
  state: "READY",
  epoch: 0,
  tabId: null,
  actions: [
    {
      id: "init_1",
      type: "system_init",
      target: "NVIDIA NIM Agent Engine",
      details: "Ready · Models: llama-3.3-70b-instruct, neva-22b (vision)",
      startTime: Date.now(),
      durationMs: 12,
      status: "success",
      statusText: "Ready",
    },
  ],
  verifiedCount: 1,
});

renderTabs();
updateActiveSessionDisplay();

// Initialize button icons with Material 3
btnNewSession.innerHTML = `${getMaterial3Svg("add", 12)} <span>New</span>`;
btnPause.innerHTML = `${getMaterial3Svg("pause", 12)} <span>PAUSE</span>`;
btnStop.innerHTML = `${getMaterial3Svg("stop", 12)} <span>STOP</span>`;
btnRestart.innerHTML = `${getMaterial3Svg("restart_alt", 12)} <span>RESTART</span>`;
btnSteer.innerHTML = `${getMaterial3Svg("send", 12)} <span>SEND</span>`;

// Query bridge status from background
chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, (response) => {
  if (response?.connected) {
    statusBadge.textContent = "● Connected";
    statusBadge.className = "status-badge connected";
  } else {
    statusBadge.textContent = "○ Standby";
    statusBadge.className = "status-badge disconnected";
  }
});

// Render session tabs
function renderTabs(): void {
  tabsList.innerHTML = "";
  for (const session of sessions.values()) {
    const tabEl = document.createElement("div");
    tabEl.className = `session-tab ${session.runId === activeRunId ? "active" : ""}`;
    tabEl.title = `${session.name} (${session.isPinned ? "Pinned" : "Unpinned - deletes on close"})`;

    const titleSpan = document.createElement("span");
    titleSpan.textContent = session.name;
    titleSpan.onclick = () => switchSession(session.runId);

    const pinIndicator = document.createElement("span");
    pinIndicator.className = "tab-pin-indicator";
    pinIndicator.innerHTML = session.isPinned ? getMaterial3Svg("push_pin", 12) : getMaterial3Svg("push_pin_outline", 12);
    pinIndicator.title = session.isPinned ? "Pinned: preserved on close" : "Unpinned: deletes on close";
    pinIndicator.onclick = (e) => {
      e.stopPropagation();
      togglePin(session.runId);
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.innerHTML = getMaterial3Svg("close", 12);
    closeBtn.title = session.isPinned ? "Pinned session (click unpin first to close/delete)" : "Close session (deletes session)";
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
  renderTabs();
  updateActiveSessionDisplay();
}

function updateActiveSessionDisplay(): void {
  const current = sessions.get(activeRunId);
  if (!current) return;

  sessionNameText.textContent = current.name;
  tabStatusText.textContent = current.tabId ? `Attached (Tab ${current.tabId})` : "Active (Attached)";

  if (current.isPinned) {
    sessionPinStatus.innerHTML = `${getMaterial3Svg("push_pin", 12)} <span>Pinned (kept on close)</span>`;
    sessionPinStatus.style.borderColor = "var(--cyan-accent)";
    btnTogglePin.textContent = "Unpin";
  } else {
    sessionPinStatus.innerHTML = `${getMaterial3Svg("push_pin_outline", 12)} <span>Unpinned (deletes on close)</span>`;
    sessionPinStatus.style.borderColor = "var(--border)";
    btnTogglePin.textContent = "Pin";
  }

  sessionActionStats.innerHTML = `${getMaterial3Svg("bolt", 12)} <span>${current.verifiedCount} verified</span>`;
  liveActionText.textContent = `State: ${current.state} · NVIDIA NIM`;

  renderActivityFeed(current);
}

function renderActivityFeed(session: SessionData): void {
  activityFeed.innerHTML = "";
  for (const action of session.actions) {
    const card = createActionCardElement(action);
    activityFeed.appendChild(card);
  }
  activityFeed.scrollTop = activityFeed.scrollHeight;
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

// Create new session
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
    actions: [
      {
        id: `init_${Date.now()}`,
        type: "system_init",
        target: sessionName,
        details: "Session initialized with NVIDIA NIM",
        startTime: Date.now(),
        durationMs: 8,
        status: "success",
        statusText: "Ready",
      },
    ],
    verifiedCount: 0,
  };

  sessions.set(runId, newSession);
  activeRunId = runId;
  renderTabs();
  updateActiveSessionDisplay();

  // Notify background/broker
  chrome.runtime.sendMessage({
    type: "SESSION_COMMAND",
    event: "session.create",
    run_id: runId,
    payload: { name: sessionName },
  });
}

// Close session: delete on close unless pinned
function closeSession(runId: string): void {
  const session = sessions.get(runId);
  if (!session) return;

  if (session.isPinned) {
    alert(`"${session.name}" is pinned. Unpin it first if you wish to close/delete it.`);
    return;
  }

  // Unpinned session deletes on close
  deleteSession(runId, true);
}

// Manually delete session (regardless of pin status)
function deleteSession(runId: string, fromClose = false): void {
  sessions.delete(runId);

  // Notify background/broker to delete run data and journal
  chrome.runtime.sendMessage({
    type: "SESSION_COMMAND",
    event: fromClose ? "session.close" : "session.delete",
    run_id: runId,
  });

  if (sessions.size === 0) {
    // If all sessions deleted, create a fresh one
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

// Toggle pin status
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
btnDeleteSession.addEventListener("click", () => deleteSession(activeRunId));
sessionPinStatus.addEventListener("click", () => togglePin(activeRunId));

btnAttachTab.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ATTACH_ACTIVE_TAB" }, (response) => {
    const current = sessions.get(activeRunId);
    if (response?.attached && current) {
      current.tabId = response.tabId;
      tabStatusText.textContent = `Attached (Tab ${response.tabId})`;
      current.actions.push({
        id: `attach_${Date.now()}`,
        type: "system_init",
        target: `Tab ${response.tabId}`,
        details: "CDP attached and authorized",
        startTime: Date.now(),
        durationMs: 45,
        status: "success",
      });
      renderActivityFeed(current);
    } else {
      tabStatusText.textContent = "Attach Failed";
    }
  });
});

btnPause.addEventListener("click", () => {
  dispatchControl("pause");
  liveActionText.textContent = "PAUSED · Awaiting resume";
  liveDot.style.color = "var(--magenta-steer)";
});

btnStop.addEventListener("click", () => {
  dispatchControl("stop");
  liveActionText.textContent = "STOPPED · Execution halted";
  liveDot.style.color = "var(--red-error)";
});

btnRestart.addEventListener("click", () => {
  dispatchControl("restart");
  liveActionText.textContent = "RESTARTING · Epoch reset";
  liveDot.style.color = "var(--cyan-accent)";
});

btnSteer.addEventListener("click", () => {
  const text = steerInput.value.trim();
  if (text) {
    dispatchControl("steer", text);
    steerInput.value = "";
    
    // Add steer card to timeline
    const steerEntry = document.createElement("div");
    steerEntry.className = "timeline-entry steer";
    const roleTag = document.createElement("span");
    roleTag.className = "role-tag";
    roleTag.textContent = "STEER (USER)";
    const content = document.createElement("p");
    content.className = "content-text";
    content.textContent = text;
    steerEntry.appendChild(roleTag);
    steerEntry.appendChild(content);
    timelineContainer.insertBefore(steerEntry, document.getElementById("live-action-box"));

    const current = sessions.get(activeRunId);
    if (current) {
      current.actions.push({
        id: `steer_${Date.now()}`,
        type: "system_init",
        target: `Steer: "${text}"`,
        details: "Dispatched mid-flight instruction to model",
        startTime: Date.now(),
        durationMs: 15,
        status: "success",
      });
      renderActivityFeed(current);
    }
  }
});

btnTakeOver.addEventListener("click", () => {
  dispatchControl("take_over");
  liveActionText.textContent = "MANUAL TAKEOVER · Agent paused";
  liveDot.style.color = "var(--magenta-steer)";
});

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

  if (msg.event === "run.state_changed" && msg.payload) {
    session.state = msg.payload.new_state;
    if (msg.epoch !== undefined) session.epoch = msg.epoch;
    if (targetRunId === activeRunId) {
      liveActionText.textContent = `State: ${session.state} · NVIDIA NIM`;
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
      renderActivityFeed(session);
    }
  } else if (msg.event === "action.finished") {
    // Locate the active action
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
      liveActionText.textContent = "Verified · NVIDIA NIM ready";
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
      renderActivityFeed(session);
    }
  }
});
