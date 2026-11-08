import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:8000"),
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
