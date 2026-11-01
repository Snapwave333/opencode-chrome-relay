import fs from "fs";
import path from "path";
import { test, expect, sendToTab } from "./support/fixtures";
import { DOCK_HOST_ID, EXTENSION_DIR, OVERLAY_HOST_ID } from "./support/paths";

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf-8"));

test.describe("Extension runtime in real Chrome", () => {
  test("registers the MV3 service worker under the manifest-pinned extension id", async ({
    serviceWorker,
    extensionId,
  }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/${manifest.background.service_worker}`);

    const runtime = await serviceWorker.evaluate(() => {
      const m = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
      return {
        id: chrome.runtime.id,
        manifestVersion: m.manifest_version,
        name: m.name,
        version: m.version,
        sidePanel: (m as any).side_panel?.default_path,
        actionTitle: m.action?.default_title,
      };
    });

    expect(runtime).toEqual({
      id: extensionId,
      manifestVersion: 3,
      name: "OpenCode Chrome Relay",
      version: manifest.version,
      sidePanel: "dist/sidepanel/index.html",
      actionTitle: expect.stringContaining("OpenCode Chrome Relay"),
    });
  });

  test("serves every asset the manifest references from the packaged extension", async ({ serviceWorker }) => {
    const referenced = new Set<string>([
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      ...manifest.content_scripts.flatMap((cs: { js: string[] }) => cs.js),
      ...Object.values<string>(manifest.icons),
      ...Object.values<string>(manifest.action.default_icon),
      "dist/sidepanel/sidepanel.js",
      "dist/sidepanel/sidepanel.css",
    ]);

    const results = await serviceWorker.evaluate(async (paths) => {
      const out: Record<string, number> = {};
      for (const p of paths) {
        const res = await fetch(chrome.runtime.getURL(p));
        out[p] = (await res.arrayBuffer()).byteLength;
      }
      return out;
    }, [...referenced]);

    for (const [asset, bytes] of Object.entries(results)) {
      expect(bytes, `${asset} should be non-empty`).toBeGreaterThan(0);
    }
  });

  test("injects a closed-shadow overlay host only once the agent acts, without blocking interaction", async ({
    extPage,
    shadow,
    serviceWorker,
    fixtureServerUrl,
  }) => {
    const url = `${fixtureServerUrl}/test_page.html`;
    await extPage.goto(url);
    await expect(extPage).toHaveTitle("OpenCode Relay Target Page");

    const host = extPage.locator(`#${OVERLAY_HOST_ID}`);
    await expect(host).toHaveCount(0);
    await sendToTab(serviceWorker, url, {
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_scroll", scroll_direction: "down", scroll_amount: 1 },
    });
    await expect(host).toBeAttached();
    await expect(host).toHaveCount(1);
    await expect(host).toHaveCSS("pointer-events", "none");
    await expect.poll(() => shadow.shadowMode(OVERLAY_HOST_ID)).toBe("closed");

    await extPage.getByRole("button", { name: "Confirm Purchase" }).click();
    await expect(extPage.locator("#click-count")).toHaveText("1");
    await extPage.getByRole("textbox", { name: "Username field" }).fill("test_user");
    await expect(extPage.locator("#target-input")).toHaveValue("test_user");
  });

  test("renders service-worker driven previews and outcomes inside the closed shadow root", async ({
    extPage,
    shadow,
    serviceWorker,
    fixtureServerUrl,
  }) => {
    const url = `${fixtureServerUrl}/test_page.html`;
    await extPage.goto(url);

    await sendToTab(serviceWorker, url, {
      type: "OVERLAY_ACTION_PREVIEW",
      action: { type: "browser_click", locator: { selector: "#target-button", name: "Confirm Purchase" } },
    });

    await expect
      .poll(async () => (await shadow.state(OVERLAY_HOST_ID, ".caption-badge"))?.text)
      .toBe("Clicking: Confirm Purchase");

    const target = (await extPage.locator("#target-button").boundingBox())!;
    const frame = (await shadow.state(OVERLAY_HOST_ID, ".highlight-box"))!;
    expect(frame.visible).toBe(true);
    expect(frame.rect.x + frame.rect.width / 2).toBeCloseTo(target.x + target.width / 2, -1);
    expect(frame.rect.y + frame.rect.height / 2).toBeCloseTo(target.y + target.height / 2, -1);

    await sendToTab(serviceWorker, url, { type: "OVERLAY_ACTION_OUTCOME", success: true, message: "confirmed" });
    await expect
      .poll(async () => (await shadow.state(OVERLAY_HOST_ID, ".caption-badge"))?.classes)
      .toContain("verified");

    await sendToTab(serviceWorker, url, { type: "CLEAR_OVERLAY" });
    await expect.poll(async () => (await shadow.state(OVERLAY_HOST_ID, ".highlight-box"))?.visible).toBe(false);
  });

  test("routes in-page dock controls back to the service worker", async ({
    extPage,
    shadow,
    serviceWorker,
    fixtureServerUrl,
  }) => {
    const url = `${fixtureServerUrl}/test_page.html`;
    await extPage.goto(url);

    await serviceWorker.evaluate(() => {
      const scope = globalThis as any;
      scope.__e2eControls = [];
      if (!scope.__e2eControlTap) {
        scope.__e2eControlTap = (msg: any) => {
          if (msg?.type === "DISPATCH_CONTROL") scope.__e2eControls.push(msg.command);
        };
        chrome.runtime.onMessage.addListener(scope.__e2eControlTap);
      }
    });

    await sendToTab(serviceWorker, url, { type: "SHOW_IN_PAGE_DOCK" });
    await expect(extPage.locator(`#${DOCK_HOST_ID}`)).toBeAttached();
    await expect.poll(() => shadow.shadowMode(DOCK_HOST_ID)).toBe("closed");

    await shadow.click(DOCK_HOST_ID, ".btn-pause");
    await shadow.click(DOCK_HOST_ID, ".btn-stop");
    await expect
      .poll(() => serviceWorker.evaluate(() => (globalThis as any).__e2eControls))
      .toEqual(["pause", "stop"]);

    await shadow.click(DOCK_HOST_ID, ".dismiss-btn");
    await expect(extPage.locator(`#${DOCK_HOST_ID}`)).toHaveCount(0);
  });

  test("boots the packaged side panel against the live service worker", async ({ extPage, extensionId }) => {
    await extPage.goto(`chrome-extension://${extensionId}/${manifest.side_panel.default_path}`);

    await expect(extPage.locator(".logo-title")).toHaveText("OpenCode Relay");
    await expect(extPage.locator(".session-tab")).toHaveCount(1);
    await expect(extPage.locator("#btn-pause svg.m3-icon")).toBeVisible();

    await extPage.locator("#steer-input").fill("hello from e2e");
    await expect(extPage.locator("#btn-steer-send")).toBeEnabled();
  });

  test("reports an offline bridge when no broker is reachable", async ({ extPage, extensionId }) => {
    await extPage.goto(`chrome-extension://${extensionId}/${manifest.side_panel.default_path}`);
    await expect(extPage.locator("#bridge-status-text")).toHaveText("Offline");
    await expect(extPage.locator("#bridge-status-badge")).toHaveClass(/disconnected/);
  });
});
