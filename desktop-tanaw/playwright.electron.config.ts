import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-electron",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 8000 },
  reporter: [["list"]],
  workers: 1,
});
