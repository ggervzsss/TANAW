import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const webUrl = process.env.TANAW_DESKTOP_E2E_WEB_URL ?? "http://127.0.0.1:5175";
const apiUrl = process.env.TANAW_DESKTOP_E2E_API_URL ?? "http://127.0.0.1:8012";
const web = new URL(webUrl);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
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
    command: `npm run build && npm run preview:web -- --host ${web.hostname} --port ${web.port || "5175"}`,
    url: webUrl,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...process.env,
      TANAW_RENDERER_ONLY: "true",
      VITE_API_BASE_URL: apiUrl,
    },
  },
});
