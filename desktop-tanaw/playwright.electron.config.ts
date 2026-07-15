import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-electron",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
