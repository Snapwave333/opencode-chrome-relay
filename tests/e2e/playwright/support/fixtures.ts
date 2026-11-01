import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { RelayHarness, type ChromeMockConfig } from "./chrome-mock";
import { ClosedShadowInspector } from "./closed-shadow";
import { FakeBroker, type Envelope } from "./fake-broker";
import { BROKER_PORT, EXTENSION_DIR, FIXTURES_DIR } from "./paths";
import type { WebSocket } from "ws";
import { randomUUID } from "crypto";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = path.normalize(path.join(FIXTURES_DIR, requested === "/" ? "test_page.html" : requested));
    if (!file.startsWith(FIXTURES_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type UiFixtures = {
  chromeMock: ChromeMockConfig;
  relay: RelayHarness;
  pageErrors: string[];
};

export interface RelayTarget {
  page: Page;
  url: string;
  tabId: number;
  socket: WebSocket;
  broker: FakeBroker;
  run: (action: Envelope, options?: { idempotencyKey?: string; tabId?: number }) => Promise<Envelope>;
}

type ExtensionTestFixtures = {
  extPage: Page;
  shadow: ClosedShadowInspector;
  relayTarget: RelayTarget;
};

type WorkerFixtures = {
  broker: FakeBroker | null;
  fixtureServerUrl: string;
  extensionContext: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
};

export const test = base.extend<UiFixtures & ExtensionTestFixtures, WorkerFixtures>({
  chromeMock: [{}, { option: true }],

  relay: async ({ page, chromeMock }, use) => {
    const harness = new RelayHarness(page);
    await harness.install(chromeMock);
    await use(harness);
  },

  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(errors);
    expect(errors, "uncaught page errors").toEqual([]);
  },

  fixtureServerUrl: [
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server.url);
      await server.close();
    },
    { scope: "worker" },
  ],

  broker: [
    async ({}, use) => {
      const broker = await FakeBroker.start(BROKER_PORT);
      await use(broker);
      await broker?.close();
    },
    { scope: "worker" },
  ],

  relayTarget: async ({ broker, extPage, fixtureServerUrl }, use) => {
    test.skip(!broker, `port ${BROKER_PORT} is busy (is a real relay broker running?)`);
    const url = `${fixtureServerUrl}/test_page.html?client=${randomUUID()}`;
    await extPage.goto(url);
    const { socket, tabId } = await broker!.findClientByTabUrl(url);
    await use({
      page: extPage,
      url,
      tabId,
      socket,
      broker: broker!,
      run: (action, options = {}) =>
        broker!.dispatch(socket, action, { tabId: options.tabId ?? tabId, idempotencyKey: options.idempotencyKey }),
    });
  },

  extensionContext: [
    async ({ channel, headless }, use) => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-relay-e2e-"));
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel,
        headless,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
      try {
        await use(context);
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],

  serviceWorker: [
    async ({ extensionContext }, use) => {
      const worker =
        extensionContext.serviceWorkers().find((sw) => sw.url().startsWith("chrome-extension://")) ??
        (await extensionContext.waitForEvent("serviceworker", { timeout: 15_000 }));
      await use(worker);
    },
    { scope: "worker" },
  ],

  extensionId: [
    async ({ serviceWorker }, use) => {
      await use(new URL(serviceWorker.url()).host);
    },
    { scope: "worker" },
  ],

  extPage: async ({ extensionContext }, use) => {
    const page = await extensionContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    await page.close();
    expect(errors, "uncaught page errors").toEqual([]);
  },

  shadow: async ({ extPage }, use) => {
    const inspector = await ClosedShadowInspector.attach(extPage);
    await use(inspector);
    await inspector.detach();
  },
});

export async function sendToTab(worker: Worker, pageUrl: string, message: Record<string, unknown>): Promise<void> {
  await worker.evaluate(
    async ({ url, msg }) => {
      for (let attempt = 0; ; attempt++) {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === url);
        try {
          if (!tab?.id) throw new Error(`no tab open at ${url}`);
          await chrome.tabs.sendMessage(tab.id, msg);
          return;
        } catch (error) {
          if (attempt >= 40) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
    { url: pageUrl, msg: message }
  );
}

export { expect };
