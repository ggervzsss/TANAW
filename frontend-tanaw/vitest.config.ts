import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:8000"),
    "import.meta.env.VITE_CARTO_BASEMAP_API_KEY": JSON.stringify(""),
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    // `npm run test:coverage`: branch coverage of the critical portal workflows. The thresholds
    // are the measured baseline; raise them when tests improve, and never lower them silently.
    coverage: {
      provider: "v8",
      include: ["src/features/reports/{model,utils,hooks}/**/*.ts", "src/shared/realtime/**/*.ts", "src/app/store/authStore.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        "src/features/reports/**": { branches: 54.5 },
        "src/shared/realtime/**": { branches: 64.5 },
        "src/app/store/**": { branches: 25 },
      },
    },
  },
});
