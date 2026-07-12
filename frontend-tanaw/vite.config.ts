import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { buildContentSecurityPolicy, resolveApiBaseUrl } from "./deployment.config";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicDeployment = (process.env.VERCEL ?? env.VERCEL) === "1" || (process.env.TANAW_PUBLIC_DEPLOYMENT ?? env.TANAW_PUBLIC_DEPLOYMENT)?.toLowerCase() === "true";
  const apiBaseUrl = resolveApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, { publicDeployment });
  const contentSecurityPolicy = buildContentSecurityPolicy(apiBaseUrl, {
    upgradeInsecureRequests: publicDeployment,
  });

  return {
    plugins: [
      {
        name: "tanaw-deployment-content-security-policy",
        enforce: "pre",
        transformIndexHtml: {
          order: "pre",
          handler: () => [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: contentSecurityPolicy,
              },
              injectTo: "head-prepend",
            },
          ],
        },
      },
      react(),
      tailwindcss(),
    ],
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
