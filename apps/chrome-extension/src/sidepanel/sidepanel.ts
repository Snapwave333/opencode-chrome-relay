// Side panel UI Logic

const statusBadge = document.getElementById("bridge-status-badge") as HTMLElement;
const btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnRestart = document.getElementById("btn-restart") as HTMLButtonElement;
const btnSteer = document.getElementById("btn-steer-send") as HTMLButtonElement;
const steerInput = document.getElementById("steer-input") as HTMLInputElement;
const btnTakeOver = document.getElementById("btn-take-over") as HTMLButtonElement;
const btnAttachTab = document.getElementById("btn-attach-tab") as HTMLButtonElement;
const tabStatusText = document.getElementById("tab-status") as HTMLElement;
const liveActionText = document.getElementById("live-action-text") as HTMLElement;
const actionStepsList = document.getElementById("action-steps-list") as HTMLUListElement;

let currentRunId = "run_1";
let currentEpoch = 0;

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

btnAttachTab.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ATTACH_ACTIVE_TAB" }, (response) => {
    if (response?.attached) {
      tabStatusText.textContent = `Attached (Tab ${response.tabId})`;
      addTimelineStep(`Attached to Tab ${response.tabId}`);
    } else {
      tabStatusText.textContent = "Attach Failed";
    }
  });
});

btnPause.addEventListener("click", () => {
  dispatchControl("pause");
});

btnStop.addEventListener("click", () => {
  dispatchControl("stop");
});

btnRestart.addEventListener("click", () => {
  dispatchControl("restart");
});

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
  chrome.runtime.sendMessage({
    type: "DISPATCH_CONTROL",
    command,
    run_id: currentRunId,
    epoch: currentEpoch,
    instruction,
  });
}

function addTimelineStep(text: string, className: "done" | "active" = "done"): void {
  const li = document.createElement("li");
  li.className = `step-item ${className}`;
  li.textContent = className === "active" ? `◉ ${text}` : `▸ ${text}`;
  actionStepsList.appendChild(li);
}

// Listen for broadcast events from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.event === "run.state_changed" && msg.payload) {
    liveActionText.textContent = `State: ${msg.payload.new_state}`;
    if (msg.epoch !== undefined) {
      currentEpoch = msg.epoch;
    }
  } else if (msg.event === "action.started" && msg.action) {
    addTimelineStep(`Action started: ${msg.action.type}`, "active");
  } else if (msg.event === "action.finished") {
    addTimelineStep("Action finished and verified", "done");
  }
});
