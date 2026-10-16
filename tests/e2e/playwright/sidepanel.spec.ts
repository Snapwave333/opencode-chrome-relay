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
    // Initial system card is rendered
    const activityFeed = page.locator("#activity-feed");
    const initialCard = activityFeed.locator(".action-card");
    await expect(initialCard).toHaveCount(1);
    await expect(initialCard.first()).toContainText("SYSTEM");

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

    await expect(activityFeed.locator(".action-card")).toHaveCount(2);
    const clickCard = activityFeed.locator(".action-card").nth(1);
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
    await expect(page.locator("#session-action-stats")).toContainText("2 verified");
  });

  test("handles live user steering and appends steer card to timeline", async ({ page }) => {
    const steerInput = page.locator("#steer-input");
    await steerInput.fill("Focus on the primary navigation menu instead");
    await page.click("#btn-steer-send");

    // Input cleared
    await expect(steerInput).toHaveValue("");

    // Steer entry added to timeline
    const steerEntry = page.locator(".timeline-entry.steer");
    await expect(steerEntry).toBeVisible();
    await expect(steerEntry).toContainText("STEER (USER)");
    await expect(steerEntry).toContainText("Focus on the primary navigation menu instead");
  });
});
