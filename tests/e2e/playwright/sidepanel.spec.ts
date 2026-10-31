import { test, expect } from "./support/fixtures";
import { SIDEPANEL_HTML } from "./support/paths";

test.beforeEach(async ({ page, relay, pageErrors }) => {
  expect(pageErrors).toEqual([]);
  await page.goto(`file://${SIDEPANEL_HTML}`);
  await expect(page.locator(".session-tab")).toHaveCount(1);
  expect(await relay.listenerCount()).toBe(1);
});

test.describe("Sidepanel cockpit with a connected bridge", () => {
  test.use({
    chromeMock: {
      responses: {
        GET_BRIDGE_STATUS: { connected: true },
        ATTACH_ACTIVE_TAB: { attached: true, tabId: 101 },
      },
    },
  });

  test("renders header, bridge status, and model badge", async ({ page, relay }) => {
    await expect(page.locator(".logo-title")).toHaveText("OpenCode Relay");
    await expect(page.locator("#bridge-status-badge")).toContainText("Connected");
    await expect(page.locator("#bridge-status-badge")).toHaveClass(/connected/);
    await expect(page.locator("#model-name")).toContainText("NVIDIA NIM");
    expect(await relay.sentOfType("GET_BRIDGE_STATUS")).toHaveLength(1);
  });

  test("renders Material 3 vector icons on control buttons and status tags", async ({ page }) => {
    await expect(page.locator("#session-pin-status svg.m3-icon")).toBeVisible();
    await expect(page.locator("#session-pin-status")).toContainText("Unpinned");
    await expect(page.locator("#session-action-stats svg.m3-icon")).toBeVisible();
    for (const id of ["btn-pause", "btn-stop", "btn-restart", "btn-steer-send", "btn-new-session"]) {
      await expect(page.locator(`#${id} svg.m3-icon`)).toBeVisible();
    }
  });

  test("creates, pins, and closes session tabs while syncing session commands", async ({ page, relay }) => {
    const tabs = page.locator(".session-tab");
    await expect(tabs.first()).toContainText("Task 1");

    await page.click("#btn-new-session");
    await expect(tabs).toHaveCount(2);
    await expect(page.locator("#session-name")).toHaveText("Task 2");

    await page.click("#btn-toggle-pin");
    await expect(page.locator("#session-pin-status")).toContainText("Pinned");
    await page.click("#btn-toggle-pin");
    await expect(page.locator("#session-pin-status")).toContainText("Unpinned");

    await page.click(".session-tab.active .tab-close-btn");
    await expect(tabs).toHaveCount(1);
    await expect(page.locator("#session-name")).toHaveText("Task 1");

    const events = (await relay.sentOfType("SESSION_COMMAND")).map((msg) => [msg.event, msg.payload ?? null]);
    expect(events).toEqual([
      ["session.create", { name: "Task 2" }],
      ["session.pin", { is_pinned: true }],
      ["session.pin", { is_pinned: false }],
      ["session.close", null],
    ]);
  });

  test("refuses to close or delete a pinned session and explains why", async ({ page, relay }) => {
    await page.click("#btn-new-session");
    await page.click("#btn-toggle-pin");

    await page.click(".session-tab.active .tab-close-btn");
    await expect(page.locator("#panel-notice")).toHaveText("Unpin Task 2 before closing it.");
    await expect(page.locator("#panel-notice")).toHaveClass(/is-visible/);
    await expect(page.locator(".session-tab")).toHaveCount(2);

    await page.click("#btn-delete-session");
    await expect(page.locator("#delete-dialog")).toBeHidden();
    await expect(page.locator("#panel-notice")).toHaveText("Unpin Task 2 before deleting it.");

    const events = (await relay.sentOfType("SESSION_COMMAND")).map((msg) => msg.event);
    expect(events).not.toContain("session.close");
    expect(events).not.toContain("session.delete");
  });

  test("updates the live activity feed when actions start and finish", async ({ page, relay }) => {
    const feed = page.locator("#activity-feed");
    await expect(feed.locator(".action-card")).toHaveCount(0);

    await relay.emit({
      event: "action.started",
      idempotency_key: "act_test_1",
      action: { type: "browser_click", locator: { selector: "#submit-btn" } },
    });

    const card = feed.locator(".action-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/action-browser_click/);
    await expect(card).toHaveClass(/active/);
    await expect(card).toContainText("CLICK");
    await expect(card).toContainText("#submit-btn");
    await expect(card).toContainText("Running");
    await expect(page.locator("#live-action-text")).toContainText("Running: #submit-btn");

    await relay.emit({
      event: "action.finished",
      idempotency_key: "act_test_1",
      payload: { outcome_summary: "Button clicked successfully" },
    });

    await expect(card).toHaveClass(/success/);
    await expect(card).toContainText("Verified");
    await expect(card).toContainText("Button clicked successfully");
    await expect(page.locator("#session-action-stats")).toContainText("1 verified");
  });

  test("marks the running action as failed with the reported error", async ({ page, relay }) => {
    await relay.emit({
      event: "action.started",
      idempotency_key: "act_fail",
      action: { type: "browser_type", text: "hello", locator: { selector: "#email" } },
    });
    await relay.emit({ event: "action.failed", payload: { error: "Element detached" } });

    const card = page.locator("#activity-feed .action-card");
    await expect(card).toHaveClass(/failed/);
    await expect(card).toContainText("Failed");
    await expect(card).toContainText("Element detached");
    await expect(page.locator("#live-action-text")).toHaveText("Failed: Element detached");
    await expect(page.locator("#session-action-stats")).toContainText("0 verified");
  });

  test("routes events to their own session and ignores unknown run ids", async ({ page, relay }) => {
    await page.click("#btn-new-session");
    const firstRunId = (await relay.sentOfType("SESSION_COMMAND"))[0].run_id;
    expect(firstRunId).toBeTruthy();

    await relay.emit({
      event: "action.started",
      run_id: "run_does_not_exist",
      action: { type: "browser_click", locator: { selector: "#ghost" } },
    });
    await expect(page.locator("#activity-feed .action-card")).toHaveCount(0);

    await relay.emit({
      event: "action.started",
      run_id: firstRunId,
      action: { type: "browser_click", locator: { selector: "#task-two" } },
    });
    await expect(page.locator("#activity-feed .action-card")).toContainText("#task-two");

    await page.locator(".session-tab").first().click();
    await expect(page.locator("#session-name")).toHaveText("Task 1");
    await expect(page.locator("#activity-feed .action-card")).toHaveCount(0);
  });

  test("applies run.state_changed to the live state and execution controls", async ({ page, relay }) => {
    await relay.emit({ event: "run.state_changed", epoch: 3, payload: { new_state: "PAUSED" } });
    await expect(page.locator("#live-action-text")).toHaveText("PAUSED");
    await expect(page.locator("#btn-pause")).toContainText("RESUME");
    await expect(page.locator("#btn-pause")).toHaveAttribute("aria-pressed", "true");

    await page.click("#btn-pause");
    expect(await relay.lastSent()).toMatchObject({ type: "DISPATCH_CONTROL", command: "resume", epoch: 3 });
  });

  test("sends chat with history, renders agent replies, and isolates chat per session", async ({ page, relay }) => {
    const composer = page.locator("#steer-input");
    await composer.fill("ping");
    await page.click("#btn-steer-send");

    await expect(composer).toHaveValue("");
    const steerEntry = page.locator(".timeline-entry.steer");
    await expect(steerEntry).toBeVisible();
    await expect(steerEntry).toContainText("STEER (USER)");
    await expect(steerEntry).toContainText("ping");
    await expect(page.locator("#activity-feed .action-card")).toHaveCount(0);

    expect(await relay.lastSent()).toMatchObject({
      type: "DISPATCH_CONTROL",
      command: "steer",
      instruction: "ping",
      history: [{ role: "user", text: "ping" }],
    });

    await relay.emit({
      event: "chat.response",
      run_id: "run_1",
      payload: { text: "Pong! Ready to assist.", model: "poolside/laguna-xs-2.1" },
    });

    const agentEntry = page.locator(".timeline-entry.agent");
    await expect(agentEntry).toBeVisible();
    await expect(agentEntry).toContainText("Pong! Ready to assist.");
    await expect(page.locator("#model-name")).toHaveText("NVIDIA NIM · laguna-xs-2.1");

    await composer.fill("second message via enter");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(page.locator(".timeline-entry.user")).toHaveCount(2);

    const second = await relay.lastSent();
    expect(second?.history?.map((h: { role: string }) => h.role)).toEqual(["user", "agent", "user"]);

    await page.click("#btn-new-session");
    await expect(page.locator(".timeline-entry")).toHaveCount(0);
  });

  test("keeps the composer guarded against blank input and supports multi-line drafts", async ({ page, relay }) => {
    const composer = page.locator("#steer-input");
    const send = page.locator("#btn-steer-send");

    await expect(send).toBeDisabled();
    await composer.fill("   ");
    await expect(send).toBeDisabled();
    await expect(page.locator("#composer-count")).toHaveText("3 / 4000");

    await composer.fill("Inspect the current page");
    await expect(send).toBeEnabled();
    await expect(page.locator("#composer-count")).toHaveText("24 / 4000");

    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("Inspect the current page\n");
    expect(await relay.sentOfType("DISPATCH_CONTROL")).toEqual([]);

    await expect(composer).toHaveAttribute("maxlength", "4000");
  });

  test("toggles pause/resume and take-over/return with matching control commands", async ({ page, relay }) => {
    const steps: Array<[string, string, string]> = [
      ["#btn-pause", "RESUME", "pause"],
      ["#btn-pause", "PAUSE", "resume"],
      ["#btn-take-over", "RETURN", "take_over"],
      ["#btn-take-over", "TAKE OVER", "return_control"],
    ];

    for (const [selector, label, command] of steps) {
      await page.click(selector);
      await expect(page.locator(selector)).toContainText(label);
      expect(await relay.lastSent()).toMatchObject({ type: "DISPATCH_CONTROL", command });
    }
    await expect(page.locator("#live-action-text")).toContainText("Control returned");
  });

  test("guards deletion behind a confirmation dialog that can be cancelled", async ({ page, relay }) => {
    await page.click("#btn-new-session");
    const dialog = page.locator("#delete-dialog");

    await page.click("#btn-delete-session");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#delete-dialog-title")).toHaveText("Delete Task 2?");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(".session-tab")).toHaveCount(2);

    await page.click("#btn-delete-session");
    await page.getByRole("button", { name: "Delete session", exact: true }).click();
    await expect(page.locator(".session-tab")).toHaveCount(1);
    expect((await relay.sentOfType("SESSION_COMMAND")).at(-1)).toMatchObject({ event: "session.delete" });
  });

  test("deleting the last session recreates a fresh Task 1", async ({ page }) => {
    await page.click("#btn-delete-session");
    await page.getByRole("button", { name: "Delete session", exact: true }).click();
    await expect(page.locator(".session-tab")).toHaveCount(1);
    await expect(page.locator("#session-name")).toHaveText("Task 1");
  });

  test("attaches the active tab and reports it in the session header", async ({ page, relay }) => {
    await page.click("#btn-attach-tab");
    await expect(page.locator("#tab-status")).toHaveText("Attached to tab 101");
    await expect(page.locator("#panel-notice")).toHaveText("Attached Task 1 to tab 101.");
    expect(await relay.sentOfType("ATTACH_ACTIVE_TAB")).toHaveLength(1);

    await page.locator("#steer-input").fill("click buy");
    await page.locator("#steer-input").press("Enter");
    expect(await relay.lastSent()).toMatchObject({ command: "steer", tab_id: 101 });
  });
});

test.describe("Sidepanel cockpit with an offline bridge", () => {
  test.use({
    chromeMock: {
      responses: {
        GET_BRIDGE_STATUS: { connected: false },
        ATTACH_ACTIVE_TAB: { attached: false },
      },
    },
  });

  test("shows the offline status badge", async ({ page }) => {
    await expect(page.locator("#bridge-status-text")).toHaveText("Offline");
    await expect(page.locator("#bridge-status-badge")).toHaveClass(/disconnected/);
  });

  test("surfaces a failed tab attachment", async ({ page }) => {
    await page.click("#btn-attach-tab");
    await expect(page.locator("#tab-status")).toHaveText("Attachment failed");
    await expect(page.locator("#panel-notice")).toHaveText("Could not attach the active tab.");
  });
});
