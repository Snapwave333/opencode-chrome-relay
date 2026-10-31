import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { axeViolations } from "./support/a11y";
import { CONTENT_SCRIPT, DOCK_HOST_ID, OVERLAY_HOST_ID, TEST_PAGE } from "./support/paths";

test.use({ chromeMock: { openShadowRoots: true } });

async function inlineGeometry(locator: Locator) {
  return locator.evaluate((el: HTMLElement) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  }));
}

async function dispatchVisualAction(page: Page, detail: Record<string, unknown>) {
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent("OPENCODE_RELAY_VISUAL_ACTION", { detail: d })), detail);
}

test.beforeEach(async ({ page, relay, pageErrors }) => {
  expect(pageErrors).toEqual([]);
  await page.clock.install();
  await page.goto(`file://${TEST_PAGE}`);
  await page.addScriptTag({ path: CONTENT_SCRIPT });
  await expect(page.locator(`#${OVERLAY_HOST_ID}`)).toBeAttached();
  expect(await relay.listenerCount()).toBe(1);
});

test.describe("In-page action overlay", () => {
  test("mounts one transparent host that never steals page input and heartbeats the worker", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    await expect(host).toHaveCSS("pointer-events", "none");
    await expect(host).toHaveCSS("position", "fixed");

    await page.locator("#target-button").click();
    await page.locator("#target-input").fill("test_user");
    await expect(page.locator("#click-count")).toHaveText("1");
    await expect(page.locator("#target-input")).toHaveValue("test_user");

    expect(await relay.sentOfType("GET_BRIDGE_STATUS")).toHaveLength(1);
    await page.clock.runFor(15_000);
    expect(await relay.sentOfType("GET_BRIDGE_STATUS")).toHaveLength(2);
  });

  test("click preview frames the target, labels it, and moves the agent cursor", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#target-button", name: "Confirm Purchase" } },
    });

    const caption = host.locator(".caption-badge");
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("Clicking: Confirm Purchase");
    await expect(caption.locator("svg")).toHaveCount(1);
    const target = (await page.locator("#target-button").boundingBox())!;
    const cursor = host.locator(".agent-cursor");
    await expect(cursor).toHaveCSS("display", "block");
    await expect(cursor).toHaveClass(/clicking/);
    await expect(cursor.locator(".cursor-badge")).toContainText("Clicking");
    const transform = await cursor.evaluate((el: HTMLElement) => el.style.transform);
    const [, cursorX, cursorY] = transform.match(/translate3d\(([\d.]+)px, ([\d.]+)px/) ?? [];
    expect(Number(cursorX)).toBeCloseTo(target.x + target.width / 2, 1);
    expect(Number(cursorY)).toBeCloseTo(target.y + target.height / 2, 1);

    const highlight = host.locator(".highlight-box");
    await expect(highlight).toBeVisible();
    const frame = await inlineGeometry(highlight);
    expect(frame.left).toBeCloseTo(target.x - 2, 0);
    expect(frame.top).toBeCloseTo(target.y - 2, 0);
    expect(frame.width).toBeCloseTo(target.width + 4, 0);
    expect(frame.height).toBeCloseTo(target.height + 4, 0);
  });

  test("typing preview truncates long input in the caption and counts characters in the HUD", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    const text = "a very long secret passphrase value";
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_type", text, locator: { selector: "#target-input" } },
    });

    await expect(host.locator(".caption-badge")).toContainText('Typing "a very long secret pas..."');
    await expect(host.locator(".highlight-box")).toHaveClass(/type-mode/);
    const hud = host.locator(".typing-hud");
    await expect(hud).toBeVisible();
    await expect(hud).toContainText(`${text.length} chars`);
  });

  test("keypress preview names the pressed key", async ({ relay, page }) => {
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_keypress", key: "Enter", locator: { selector: "#target-input" } },
    });
    await expect(page.locator(`#${OVERLAY_HOST_ID} .caption-badge`)).toContainText("Pressing [Enter]");
  });

  for (const direction of ["down", "up", "left", "right"] as const) {
    test(`scroll ${direction} shows a directional marker that hides itself`, async ({ page, relay }) => {
      const marker = page.locator(`#${OVERLAY_HOST_ID} .edge-scroll-marker`);
      await relay.emit({
        type: "OVERLAY_ACTION_PREVIEW",
        action: { type: "browser_scroll", scroll_direction: direction, scroll_amount: 500 },
      });
      await expect(marker).toBeVisible();
      await expect(marker).toContainText(`Scrolling ${direction.toUpperCase()} (500px)`);
      await expect(marker.locator("svg")).toHaveCount(1);

      await page.clock.runFor(1_250);
      await expect(marker).toBeHidden();
    });
  }

  test("navigation preview animates the progress bar and announces the destination", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_navigate", url: "https://example.com/checkout" },
    });

    const progress = host.locator(".top-progress-bar");
    await expect(progress).toBeVisible();
    await expect(host.locator(".floating-toast")).toContainText("Navigating to: https://example.com/checkout");

    await page.clock.runFor(1_000);
    await expect(progress).toBeHidden();
  });

  const toastCases = [
    {
      name: "wait",
      action: { type: "browser_wait", predicate: "network idle", timeout_ms: 3000 },
      text: "Waiting: network idle (3000ms)",
    },
    {
      name: "download",
      action: { type: "browser_download", url: "https://example.com/report.pdf" },
      text: "Downloading: https://example.com/report.pdf...",
    },
  ];

  for (const { name, action, text } of toastCases) {
    test(`${name} preview raises a transient toast`, async ({ page, relay }) => {
      const toast = page.locator(`#${OVERLAY_HOST_ID} .floating-toast`);
      await relay.emit({ type: "OVERLAY_ACTION_PREVIEW", action });
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(text);
      await page.clock.runFor(2_100);
      await expect(toast).toBeHidden();
    });
  }

  test("verified outcome turns the frame green and then auto-clears", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#target-button" } },
    });
    await relay.emit({ type: "OVERLAY_ACTION_OUTCOME", success: true, message: "Element state confirmed" });

    await expect(host.locator(".highlight-box")).toHaveClass(/verified/);
    await expect(host.locator(".caption-badge")).toHaveClass(/verified/);
    await expect(host.locator(".caption-badge")).toContainText("Verified Element state confirmed");

    await page.clock.runFor(1_650);
    await expect(host.locator(".highlight-box")).toBeHidden();
    await expect(host.locator(".caption-badge")).toBeHidden();
  });

  test("failed outcome marks the frame as failed with a fallback reason", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#target-button" } },
    });
    await relay.emit({ type: "OVERLAY_ACTION_OUTCOME", success: false });

    await expect(host.locator(".highlight-box")).toHaveClass(/failed/);
    await expect(host.locator(".caption-badge")).toContainText("Failed: Action not confirmed");
  });

  test("preview auto-clears after its hold time and CLEAR_OVERLAY hides immediately", async ({ page, relay }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    const preview = {
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#target-button" } },
    };

    await relay.emit(preview);
    await expect(host.locator(".highlight-box")).toBeVisible();
    await page.clock.runFor(2_000);
    await expect(host.locator(".highlight-box")).toBeVisible();
    await page.clock.runFor(500);
    await expect(host.locator(".highlight-box")).toBeHidden();

    await relay.emit(preview);
    await expect(host.locator(".caption-badge")).toBeVisible();
    await relay.emit({ type: "CLEAR_OVERLAY" });
    await expect(host.locator(".caption-badge")).toBeHidden();
    await expect(host.locator(".highlight-box")).toBeHidden();
  });

  test("unresolvable locators leave the frame hidden instead of throwing", async ({ page, relay }) => {
    await relay.emit({
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#does-not-exist" } },
    });
    await expect(page.locator(`#${OVERLAY_HOST_ID} .highlight-box`)).toBeHidden();
    await expect(page.locator(`#${OVERLAY_HOST_ID} .caption-badge`)).toBeHidden();
  });

  test("DOM visual action events drive hover framing from the page", async ({ page }) => {
    const host = page.locator(`#${OVERLAY_HOST_ID}`);
    const target = (await page.locator("#target-button").boundingBox())!;
    await dispatchVisualAction(page, {
      type: "hover",
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      rect: { left: target.x, top: target.y, width: target.width, height: target.height },
      label: "Confirm Purchase",
    });

    await expect(host.locator(".highlight-box")).toHaveClass(/hover-mode/);
    await expect(host.locator(".caption-badge")).toContainText("Hovering: Confirm Purchase");
  });

  test("DOM keypress visual action shows the keypress HUD", async ({ page }) => {
    await dispatchVisualAction(page, { type: "keypress", x: 100, y: 100, key: "Tab" });
    const hud = page.locator(`#${OVERLAY_HOST_ID} .keypress-hud`);
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("Tab");
  });
});

test.describe("In-page execution dock", () => {
  test("renders an accessible toolbar on SHOW_IN_PAGE_DOCK exactly once", async ({ page, relay }) => {
    await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });
    await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });

    await expect(page.locator(`#${DOCK_HOST_ID}`)).toHaveCount(1);
    const toolbar = page.getByRole("toolbar", { name: "Relay execution controls" });
    await expect(toolbar).toBeVisible();
    for (const label of ["PAUSE", "STOP", "STEER"]) {
      await expect(toolbar.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(toolbar.getByRole("button", { name: "Dismiss relay controls" })).toBeVisible();
  });

  for (const [label, command] of [
    ["PAUSE", "pause"],
    ["STOP", "stop"],
    ["STEER", "steer"],
  ] as const) {
    test(`${label} button dispatches the "${command}" control command`, async ({ page, relay }) => {
      await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });
      await page.getByRole("toolbar").getByRole("button", { name: label }).click();
      await expect.poll(() => relay.lastSent()).toEqual({ type: "DISPATCH_CONTROL", command });
    });
  }

  test("dock toolbar has no WCAG 2.1 AA violations", async ({ page, relay }) => {
    await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });
    await expect(page.getByRole("toolbar")).toBeVisible();
    expect(await axeViolations(page, { include: `#${DOCK_HOST_ID}` })).toEqual([]);
  });

  test("dismiss removes the dock and it can be summoned again", async ({ page, relay }) => {
    await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });
    await page.getByRole("button", { name: "Dismiss relay controls" }).click();
    await expect(page.locator(`#${DOCK_HOST_ID}`)).toHaveCount(0);
    expect(await relay.sentOfType("DISPATCH_CONTROL")).toEqual([]);

    await relay.emit({ type: "SHOW_IN_PAGE_DOCK" });
    await expect(page.getByRole("toolbar", { name: "Relay execution controls" })).toBeVisible();
  });
});
