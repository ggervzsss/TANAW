import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Separate dev server: production-source regression tests keep mock mode disabled.
export default defineConfig({
  ...base,
  testMatch: ["**/dashboard-mock.spec.ts", "**/dark-mode.spec.ts"],
  testIgnore: [],
  outputDir: "test-results/mock-dashboard",
  use: { ...base.use, baseURL: "http://127.0.0.1:5176" },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5176 --strictPort",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: false,
    env: { TANAW_RENDERER_ONLY: "true", VITE_USE_MOCK_DATA: "true", VITE_API_BASE_URL: "http://127.0.0.1:8012" },
  },
});
