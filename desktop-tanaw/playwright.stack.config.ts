import { defineConfig, devices } from "@playwright/test";

// The disposable-stack scenario. scripts/e2e-stack/run.mjs (repository root) starts every service
// first, so this config starts none and never reuses the mocked browser-test servers.
export default defineConfig({
  testDir: "./tests/e2e/stack",
  outputDir: "./test-results/stack",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report/stack", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
