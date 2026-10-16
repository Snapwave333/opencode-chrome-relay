import { defineConfig, devices } from "@playwright/test";
import path from "path";

const extensionPath = path.resolve(__dirname, "apps/chrome-extension");

export default defineConfig({
  testDir: "./tests/e2e/playwright",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
    channel: "chrome",
    headless: false,
  },
  projects: [
    {
      name: "chrome-extension-e2e",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        launchOptions: {
          headless: false,
          ignoreDefaultArgs: ["--disable-extensions"],
          args: [
            `--headless=new`,
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            `--allow-file-access-from-files`,
            `--no-sandbox`,
            `--disable-dev-shm-usage`,
          ],
        },
      },
    },
  ],
});
