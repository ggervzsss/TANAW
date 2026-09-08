import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const developmentDevLog = process.env.TANAW_E2E_DEV_LOG === "true";
const webUrl = process.env.TANAW_E2E_WEB_URL ?? (developmentDevLog ? "http://127.0.0.1:5177" : "http://127.0.0.1:5176");
const apiUrl = process.env.TANAW_E2E_API_URL ?? "http://127.0.0.1:8011";
const web = new URL(webUrl);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: developmentDevLog ? "dev-log.spec.ts" : undefined,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webUrl,
    headless: true,
    launchOptions: executablePath ? { executablePath } : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: developmentDevLog
      ? `npm run dev -- --host ${web.hostname} --port ${web.port || "5177"}`
      : `npm run build && npm run preview -- --host ${web.hostname} --port ${web.port || "5176"}`,
    url: webUrl,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiUrl,
      VITE_CARTO_BASEMAP_API_KEY: "carto-e2e-test-key",
    },
  },
});
