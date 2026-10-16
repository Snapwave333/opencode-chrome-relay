import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Sidepanel Cockpit E2E Tests", () => {
  const sidepanelHtml = path.resolve(__dirname, "../../../apps/chrome-extension/dist/sidepanel/index.html");

  test.beforeEach(async ({ page }) => {
    // Inject mock chrome.runtime API before scripts load
    await page.addInitScript(() => {
      (window as any).chrome = {
        runtime: {
          sendMessage: (msg: any, cb?: (res: any) => void) => {
            (window as any).__lastMessage = msg;
            if (msg.type === "GET_BRIDGE_STATUS" && cb) {
              cb({ connected: true });
            } else if (msg.type === "ATTACH_ACTIVE_TAB" && cb) {
              cb({ attached: true, tabId: 101 });
            } else if (cb) {
              cb({ success: true });
            }
          },
          onMessage: {
            addListener: (listener: (msg: any) => void) => {
              (window as any).__messageListener = listener;
            },
          },
        },
      };
    });

    await page.goto(`file://${sidepanelHtml}`);
  });

  test("renders header, bridge status, and model badge", async ({ page }) => {
    const title = page.locator(".logo-title");
    await expect(title).toHaveText("OpenCode Relay");

    const statusBadge = page.locator("#bridge-status-badge");
    await expect(statusBadge).toContainText("Connected");

    const modelName = page.locator("#model-name");
    await expect(modelName).toContainText("NVIDIA NIM");
  });

  test("renders Material 3 vector icons on control buttons and status tags", async ({ page }) => {
    // Session pin status contains Material 3 push_pin SVG
    const pinStatus = page.locator("#session-pin-status");
    await expect(pinStatus.locator("svg.m3-icon")).toBeVisible();
    await expect(pinStatus).toContainText("Unpinned");

    // Action stats badge contains Material 3 bolt SVG
    const actionStats = page.locator("#session-action-stats");
    await expect(actionStats.locator("svg.m3-icon")).toBeVisible();

    // Primary control buttons contain Material 3 SVGs
    await expect(page.locator("#btn-pause svg.m3-icon")).toBeVisible();
    await expect(page.locator("#btn-stop svg.m3-icon")).toBeVisible();
    await expect(page.locator("#btn-restart svg.m3-icon")).toBeVisible();
    await expect(page.locator("#btn-steer-send svg.m3-icon")).toBeVisible();
    await expect(page.locator("#btn-new-session svg.m3-icon")).toBeVisible();
  });

  test("supports multi-session tabs: create new session, pin, and delete", async ({ page }) => {
    // Initial tab
    const tabs = page.locator(".session-tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toContainText("Task 1");

    // Click "+ New"
    await page.click("#btn-new-session");
    await expect(tabs).toHaveCount(2);
    await expect(page.locator("#session-name")).toHaveText("Task 2");

    // Toggle Pin on active session
    await page.click("#btn-toggle-pin");
    await expect(page.locator("#session-pin-status")).toContainText("Pinned");

    // Toggle Unpin
    await page.click("#btn-toggle-pin");
    await expect(page.locator("#session-pin-status")).toContainText("Unpinned");

    // Close session
    await page.click(".session-tab.active .tab-close-btn");
    await expect(tabs).toHaveCount(1);
    await expect(page.locator("#session-name")).toHaveText("Task 1");
  });

  test("updates live activity feed when actions start and finish", async ({ page }) => {
    // Initially zero fake system cards
    const activityFeed = page.locator("#activity-feed");
    await expect(activityFeed.locator(".action-card")).toHaveCount(0);

    // Simulate action.started event from background
    await page.evaluate(() => {
      const listener = (window as any).__messageListener;
      if (listener) {
        listener({
          event: "action.started",
          idempotency_key: "act_test_1",
          action: {
            type: "browser_click",
            locator: { selector: "#submit-btn" },
          },
        });
      }
    });

    await expect(activityFeed.locator(".action-card")).toHaveCount(1);
    const clickCard = activityFeed.locator(".action-card").first();
    await expect(clickCard).toHaveClass(/action-browser_click/);
    await expect(clickCard).toHaveClass(/active/);
    await expect(clickCard).toContainText("CLICK");
    await expect(clickCard).toContainText("#submit-btn");
    await expect(clickCard).toContainText("Running");

    // Simulate action.finished event
    await page.evaluate(() => {
      const listener = (window as any).__messageListener;
      if (listener) {
        listener({
          event: "action.finished",
          idempotency_key: "act_test_1",
          payload: { outcome_summary: "Button clicked successfully" },
        });
      }
    });

    await expect(clickCard).toHaveClass(/success/);
    await expect(clickCard).toContainText("Verified");
    await expect(page.locator("#session-action-stats")).toContainText("1 verified");
  });

  test("handles live user chat/steering and renders agent chat.response without activity feed overhead", async ({ page }) => {
    const steerInput = page.locator("#steer-input");
    await steerInput.fill("ping");
    await page.click("#btn-steer-send");

    // Input cleared
    await expect(steerInput).toHaveValue("");

    // User entry added to chat timeline
    const steerEntry = page.locator(".timeline-entry.steer");
    await expect(steerEntry).toBeVisible();
    await expect(steerEntry).toContainText("STEER (USER)");
    await expect(steerEntry).toContainText("ping");

    // No redundant system card added to activity feed
    await expect(page.locator("#activity-feed .action-card")).toHaveCount(0);

    // Simulate chat.response from background
    await page.evaluate(() => {
      const listener = (window as any).__messageListener;
      if (listener) {
        listener({
          event: "chat.response",
          run_id: "run_1",
          payload: {
            text: "Pong! Ready to assist.",
            model: "poolside/laguna-xs-2.1",
          },
        });
      }
    });

    const agentEntry = page.locator(".timeline-entry.agent");
    await expect(agentEntry).toBeVisible();
    await expect(agentEntry).toContainText("Pong! Ready to assist.");
    await expect(page.locator("#model-name")).toContainText("laguna-xs-2.1");

    // Pressing Enter in #steer-input also submits chat message
    await steerInput.fill("second message via enter");
    await steerInput.press("Enter");
    await expect(steerInput).toHaveValue("");
    await expect(page.locator(".timeline-entry.user")).toHaveCount(2);

    // Creating a new session tab starts with a clean isolated chat view
    await page.click("#btn-new-session");
    await expect(page.locator(".timeline-entry")).toHaveCount(0);
  });

  test("supports resume, manual control return, guarded deletion, and composer feedback", async ({ page }) => {
    const composer = page.locator("#steer-input");
    const send = page.locator("#btn-steer-send");

    await expect(send).toBeDisabled();
    await composer.fill("Inspect the current page");
    await expect(send).toBeEnabled();
    await expect(page.locator("#composer-count")).toHaveText("24 / 4000");

    await page.click("#btn-pause");
    await expect(page.locator("#btn-pause")).toContainText("RESUME");
    await expect(page.locator("#live-action-text")).toContainText("PAUSED");
    expect(await page.evaluate(() => (window as any).__lastMessage.command)).toBe("pause");

    await page.click("#btn-pause");
    await expect(page.locator("#btn-pause")).toContainText("PAUSE");
    expect(await page.evaluate(() => (window as any).__lastMessage.command)).toBe("resume");

    await page.click("#btn-take-over");
    await expect(page.locator("#btn-take-over")).toContainText("RETURN");
    expect(await page.evaluate(() => (window as any).__lastMessage.command)).toBe("take_over");

    await page.click("#btn-take-over");
    await expect(page.locator("#btn-take-over")).toContainText("TAKE OVER");
    expect(await page.evaluate(() => (window as any).__lastMessage.command)).toBe("return_control");

    await page.click("#btn-new-session");
    await page.click("#btn-delete-session");
    await expect(page.locator("#delete-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Delete session", exact: true }).click();
    await expect(page.locator(".session-tab")).toHaveCount(1);
  });
});
