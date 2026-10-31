import { test, expect } from "./support/fixtures";
import { OVERLAY_HOST_ID } from "./support/paths";

test.describe.configure({ mode: "default" });

test.describe("Broker → extension → page round trip", () => {
  test("lists the client's tabs so the broker can address a specific one", async ({ relayTarget }) => {
    const reply = await relayTarget.run({ type: "browser_list_tabs" });
    expect(reply.event).toBe("action.finished");
    expect(reply.payload.tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: relayTarget.tabId, url: relayTarget.url })])
    );
  });

  test("reports a connected bridge and the addressed tab through browser_status", async ({ relayTarget }) => {
    const reply = await relayTarget.run({ type: "browser_status" });
    expect(reply.payload).toMatchObject({
      success: true,
      bridge_connected: true,
      active_tab_id: relayTarget.tabId,
      from_extension: true,
    });
  });

  test("clicks a real element, echoes protocol metadata, and shows the verified overlay", async ({
    relayTarget,
    shadow,
  }) => {
    const { page } = relayTarget;
    const reply = await relayTarget.run({
      type: "browser_click",
      locator: { selector: "#target-button", name: "Confirm Purchase" },
    });

    expect(reply).toMatchObject({
      v: 1,
      event: "action.finished",
      run_id: "run_e2e",
      action: { type: "browser_click" },
      payload: { success: true, from_extension: true },
    });
    await expect(page.locator("#click-count")).toHaveText("1");
    await expect
      .poll(async () => (await shadow.state(OVERLAY_HOST_ID, ".caption-badge"))?.classes ?? [])
      .toContain("verified");
  });

  test("drops duplicate deliveries of the same idempotency key", async ({ relayTarget }) => {
    const action = { type: "browser_click", locator: { selector: "#target-button" } };
    const idempotencyKey = `idem_dupe_${Date.now()}`;

    await relayTarget.run(action, { idempotencyKey });
    const before = relayTarget.broker.frames.length;
    relayTarget.broker.send(relayTarget.socket, {
      event: "action.started",
      run_id: "run_e2e",
      idempotency_key: idempotencyKey,
      tab_id: relayTarget.tabId,
      action,
    });
    await relayTarget.run({ type: "browser_status" });

    await expect(relayTarget.page.locator("#click-count")).toHaveText("1");
    const duplicates = relayTarget.broker.frames
      .slice(before)
      .filter((f) => f.data.idempotency_key === idempotencyKey);
    expect(duplicates).toEqual([]);
  });

  test("types into an input and fires input events", async ({ relayTarget }) => {
    const reply = await relayTarget.run({
      type: "browser_type",
      text: "relay_user",
      locator: { selector: "#target-input" },
    });
    expect(reply.event).toBe("action.finished");
    expect(reply.payload.outcome_summary).toContain("Username field");
    await expect(relayTarget.page.locator("#target-input")).toHaveValue("relay_user");
  });

  test("selects an option by visible label and fires change", async ({ relayTarget }) => {
    const reply = await relayTarget.run({ type: "browser_select", value: "Team", locator: { selector: "#plan-select" } });
    expect(reply.event).toBe("action.finished");
    await expect(relayTarget.page.locator("#plan-select")).toHaveValue("team");
    await expect(relayTarget.page.locator("#plan-choice")).toHaveText("team");
  });

  test("scrolls the page by the requested amount", async ({ relayTarget }) => {
    const reply = await relayTarget.run({ type: "browser_scroll", scroll_direction: "down", scroll_amount: 600 });
    expect(reply.payload.outcome_summary).toBe("Scrolled down (600px)");
    await expect.poll(() => relayTarget.page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("extracts page text and evaluates expressions in the tab", async ({ relayTarget }) => {
    const extracted = await relayTarget.run({ type: "browser_extract" });
    expect(extracted.payload.extracted.text).toContain("OpenCode Relay Target Interactive Page");

    const evaluated = await relayTarget.run({ type: "browser_eval", text: "document.title" });
    expect(evaluated.payload.eval_result).toBe("OpenCode Relay Target Page");
  });

  test("verifies presence and reports absence without throwing", async ({ relayTarget }) => {
    const present = await relayTarget.run({ type: "browser_verify", locator: { selector: "#target-button" } });
    expect(present.payload).toMatchObject({ success: true, verified: true });

    const absent = await relayTarget.run({ type: "browser_verify", locator: { selector: "#nope" } });
    expect(absent.event).toBe("action.finished");
    expect(absent.payload).toMatchObject({ success: false, verified: false });
  });

  test("returns action.failed with a reason when the target element is missing", async ({ relayTarget, shadow }) => {
    const reply = await relayTarget.run({ type: "browser_click", locator: { selector: "#does-not-exist" } });
    expect(reply.event).toBe("action.failed");
    expect(typeof reply.payload.error).toBe("string");
    expect(reply.payload.error.length).toBeGreaterThan(0);
    await expect(relayTarget.page.locator("#click-count")).toHaveText("0");
    await expect
      .poll(async () => (await shadow.state(OVERLAY_HOST_ID, ".caption-badge"))?.text ?? "")
      .toContain("Failed");
  });

  test("navigates the addressed tab and waits for the load to complete", async ({ relayTarget }) => {
    const target = new URL("/second_page.html", relayTarget.url).toString();
    const reply = await relayTarget.run({ type: "browser_navigate", url: target });
    expect(reply.payload).toMatchObject({ success: true, tab_id: relayTarget.tabId, url: target });
    await expect(relayTarget.page).toHaveURL(target);
    await expect(relayTarget.page.locator("#landing")).toHaveText("Navigation landed");
  });

  test("fails navigation cleanly when no URL is given", async ({ relayTarget }) => {
    const reply = await relayTarget.run({ type: "browser_navigate" });
    expect(reply).toMatchObject({ event: "action.failed", payload: { error: "Missing URL for browser_navigate" } });
  });
});

test.describe("Broker ↔ side panel relay", () => {
  test("shows a live connection, renders broker events, and forwards controls to the broker", async ({
    relayTarget,
    extensionContext,
    extensionId,
  }) => {
    const panel = await extensionContext.newPage();
    try {
      await panel.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`);
      await expect(panel.locator("#bridge-status-text")).toHaveText("Connected");

      const { broker, socket } = relayTarget;
      broker.send(socket, {
        event: "action.started",
        idempotency_key: `idem_panel_${Date.now()}`,
        tab_id: relayTarget.tabId,
        action: { type: "browser_click", locator: { selector: "#target-button" } },
      });
      await expect(panel.locator("#activity-feed .action-card")).toContainText("#target-button");
      await expect(relayTarget.page.locator("#click-count")).toHaveText("1");

      broker.send(socket, { event: "chat.response", payload: { text: "Broker says hi", model: "local" } });
      await expect(panel.locator(".timeline-entry.agent")).toContainText("Broker says hi");

      const since = broker.frames.length;
      await panel.click("#btn-pause");
      const control = await broker.waitForFrame((f) => f.socket === socket && f.data.command === "pause", 5_000, since);
      expect(control.data).toMatchObject({ command: "pause", epoch: 0 });
      expect(control.data.run_id).toMatch(/\S/);
    } finally {
      await panel.close();
    }
  });
});
