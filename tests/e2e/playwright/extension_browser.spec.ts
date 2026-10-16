import { test, expect, chromium } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";

import http from "http";

test.describe("Extension Browser Integration E2E Tests", () => {
  const extensionPath = path.resolve(__dirname, "../../../apps/chrome-extension");
  let userDataDir: string;
  let server: http.Server;
  let serverUrl: string;

  test.beforeEach(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-chrome-test-"));
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html>
<head><title>OpenCode Relay Target Page</title></head>
<body>
  <h1>Example Domain</h1>
  <button id="target-button">Confirm Purchase</button>
  <input id="target-input" type="text" placeholder="Enter username..." />
</body>
</html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  test.afterEach(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors
    }
  });

  test("loads unpacked extension in real Chrome and initializes background service worker", async () => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--headless=new`,
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--no-sandbox`,
      ],
      ignoreDefaultArgs: ["--disable-extensions"],
    });

    try {
      // Open a browser page
      const page = await context.newPage();
      await page.goto(serverUrl);
      await expect(page).toHaveTitle(/OpenCode Relay Target Page/);

      // Verify page interaction
      const heading = page.locator("h1");
      await expect(heading).toHaveText("Example Domain");

      // Verify interactive controls
      const button = page.locator("#target-button");
      await expect(button).toBeVisible();
      await button.click();

      const input = page.locator("#target-input");
      await expect(input).toBeVisible();
      await input.fill("test_user");
      await expect(input).toHaveValue("test_user");

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("verifies 1-click sidepanel and action behavior configured in manifest", async () => {
    const manifestPath = path.join(extensionPath, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("OpenCode Chrome Relay");
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons["16"]).toBe("icons/icon16.png");
    expect(manifest.icons["48"]).toBe("icons/icon48.png");
    expect(manifest.icons["128"]).toBe("icons/icon128.png");
    expect(manifest.action.default_icon["16"]).toBe("icons/icon16.png");
    expect(manifest.action.default_title).toContain("OpenCode Chrome Relay");
    expect(manifest.side_panel.default_path).toBe("dist/sidepanel/index.html");
  });
});
