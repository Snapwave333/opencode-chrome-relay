// Side panel UI Logic with Multi-Session Tabbed Interface & Pinning

interface SessionData {
  runId: string;
  name: string;
  isPinned: boolean;
  state: string;
  epoch: number;
  tabId: number | null;
  steps: { text: string; className: "done" | "active" }[];
}

const statusBadge = document.getElementById("bridge-status-badge") as HTMLElement;
const modelNameLabel = document.getElementById("model-name") as HTMLElement;
const tabsList = document.getElementById("tabs-list") as HTMLDivElement;
const btnNewSession = document.getElementById("btn-new-session") as HTMLButtonElement;
const sessionNameText = document.getElementById("session-name") as HTMLElement;
const tabStatusText = document.getElementById("tab-status") as HTMLElement;
const sessionPinStatus = document.getElementById("session-pin-status") as HTMLElement;
const btnTogglePin = document.getElementById("btn-toggle-pin") as HTMLButtonElement;
const btnDeleteSession = document.getElementById("btn-delete-session") as HTMLButtonElement;
const btnAttachTab = document.getElementById("btn-attach-tab") as HTMLButtonElement;
const liveActionText = document.getElementById("live-action-text") as HTMLElement;
const actionStepsList = document.getElementById("action-steps-list") as HTMLUListElement;

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
  steps: [{ text: "Initialized session with NVIDIA NIM", className: "done" }],
});

renderTabs();
updateActiveSessionDisplay();

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
    pinIndicator.textContent = session.isPinned ? "📌" : "📍";
    pinIndicator.title = session.isPinned ? "Pinned: preserved on close" : "Unpinned: deletes on close";
    pinIndicator.onclick = (e) => {
      e.stopPropagation();
      togglePin(session.runId);
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.textContent = "×";
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
    sessionPinStatus.textContent = "📌 Pinned (kept on close)";
    sessionPinStatus.style.borderColor = "var(--cyan-accent)";
    btnTogglePin.textContent = "Unpin";
  } else {
    sessionPinStatus.textContent = "📍 Unpinned (deletes on close)";
    sessionPinStatus.style.borderColor = "var(--border)";
    btnTogglePin.textContent = "Pin";
  }

  liveActionText.textContent = `State: ${current.state} · NVIDIA NIM`;

  // Re-render steps
  actionStepsList.innerHTML = "";
  for (const step of current.steps) {
    const li = document.createElement("li");
    li.className = `step-item ${step.className}`;
    li.textContent = step.className === "active" ? `◉ ${step.text}` : `▸ ${step.text}`;
    actionStepsList.appendChild(li);
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
    steps: [{ text: `Created ${sessionName}`, className: "done" }],
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
    if (response?.attached) {
      const current = sessions.get(activeRunId);
      if (current) {
        current.tabId = response.tabId;
        tabStatusText.textContent = `Attached (Tab ${response.tabId})`;
        addTimelineStep(`Attached to Tab ${response.tabId}`);
      }
    } else {
      tabStatusText.textContent = "Attach Failed";
    }
  });
});

btnPause.addEventListener("click", () => dispatchControl("pause"));
btnStop.addEventListener("click", () => dispatchControl("stop"));
btnRestart.addEventListener("click", () => dispatchControl("restart"));

btnSteer.addEventListener("click", () => {
  const text = steerInput.value.trim();
  if (text) {
    dispatchControl("steer", text);
    steerInput.value = "";
    addTimelineStep(`Steering: "${text}"`, "active");
  }
});

btnTakeOver.addEventListener("click", () => {
  dispatchControl("take_over");
  addTimelineStep("Manual control taken over by user", "active");
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

function addTimelineStep(text: string, className: "done" | "active" = "done"): void {
  const current = sessions.get(activeRunId);
  if (!current) return;

  current.steps.push({ text, className });
  const li = document.createElement("li");
  li.className = `step-item ${className}`;
  li.textContent = className === "active" ? `◉ ${text}` : `▸ ${text}`;
  actionStepsList.appendChild(li);
}

// Listen for broadcast events from background
chrome.runtime.onMessage.addListener((msg) => {
  const targetRunId = msg.run_id || activeRunId;
  const session = sessions.get(targetRunId);

  if (msg.event === "run.state_changed" && msg.payload) {
    if (session) {
      session.state = msg.payload.new_state;
      if (msg.epoch !== undefined) session.epoch = msg.epoch;
      if (targetRunId === activeRunId) {
        liveActionText.textContent = `State: ${session.state} · NVIDIA NIM`;
      }
    }
  } else if (msg.event === "action.started" && msg.action) {
    if (session) {
      session.steps.push({ text: `Action started: ${msg.action.type}`, className: "active" });
      if (targetRunId === activeRunId) {
        const li = document.createElement("li");
        li.className = "step-item active";
        li.textContent = `◉ Action started: ${msg.action.type}`;
        actionStepsList.appendChild(li);
      }
    }
  } else if (msg.event === "action.finished") {
    if (session) {
      session.steps.push({ text: "Action finished and verified", className: "done" });
      if (targetRunId === activeRunId) {
        const li = document.createElement("li");
        li.className = "step-item done";
        li.textContent = "▸ Action finished and verified";
        actionStepsList.appendChild(li);
      }
    }
  }
});
