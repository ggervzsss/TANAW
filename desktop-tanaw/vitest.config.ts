import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:8000"),
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    // `npm run test:coverage`: branch coverage of the critical renderer workflows. The thresholds
    // are the measured baseline; see docs/testing/coverage-and-replays.md.
    coverage: {
      provider: "v8",
      include: ["src/features/sync/**/*.ts", "src/features/reports/{model,services,utils}/**/*.ts", "src/features/realtime/**/*.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        "src/features/sync/**": { branches: 57 },
        "src/features/reports/**": { branches: 57 },
        "src/features/realtime/**": { branches: 65 },
      },
    },
  },
});
