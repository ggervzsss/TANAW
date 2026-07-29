import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rendererOnly = process.env.TANAW_RENDERER_ONLY === "true";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5174,
    warmup: {
      clientFiles: [
        "./index.html",
        "./src/main.tsx",
        "./src/index.css",
        "./src/App.tsx",
        "./src/app/providers/AppProviders.tsx",
        "./src/app/router/AppRouter.tsx",
        "./src/features/login/components/LoginPage.tsx",
      ],
    },
    watch: {
      ignored: ["**/.uv-cache/**", "**/.venv/**", "**/dist/**", "**/dist-electron/**", "**/ml-service/**", "**/playwright-report/**", "**/release/**", "**/test-results/**"],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(rendererOnly
      ? []
      : [
          electron({
            main: {
              // Shortcut of `build.lib.entry`.
              entry: "electron/main.ts",
            },
            preload: {
              // Shortcut of `build.rollupOptions.input`.
              // Preload scripts may contain web assets, so use `build.rollupOptions.input` instead of `build.lib.entry`.
              input: path.join(__dirname, "electron/preload.ts"),
            },
            // Polyfill the Electron and Node.js API for the renderer process.
            // See https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: process.env.NODE_ENV === "test" ? undefined : {},
          }),
        ]),
  ],
});
