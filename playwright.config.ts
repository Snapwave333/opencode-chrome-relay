import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const channel = process.env.PW_CHANNEL || "chrome";

export default defineConfig({
  testDir: "./tests/e2e/playwright",
  globalSetup: "./tests/e2e/playwright/global-setup.ts",
  outputDir: "./test-results/e2e",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "ui-mocked",
      testMatch: /(sidepanel|overlay_and_dock)\.spec\.ts$/,
    },
    {
      name: "extension-runtime",
      testMatch: /extension_browser\.spec\.ts$/,
    },
  ],
});
