import { randomBytes } from "node:crypto";
import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { buildContentSecurityPolicy, resolveApiBaseUrl, resolveCartoBasemapApiKey } from "./deployment.config";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicDeployment = (process.env.VERCEL ?? env.VERCEL) === "1" || (process.env.TANAW_PUBLIC_DEPLOYMENT ?? env.TANAW_PUBLIC_DEPLOYMENT)?.toLowerCase() === "true";
  const apiBaseUrl = resolveApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, { publicDeployment });
  const cartoBasemapApiKey = resolveCartoBasemapApiKey(process.env.VITE_CARTO_BASEMAP_API_KEY ?? env.VITE_CARTO_BASEMAP_API_KEY, { publicDeployment });
  const developmentCspNonce = command === "serve" ? randomBytes(16).toString("base64") : undefined;
  const contentSecurityPolicy = buildContentSecurityPolicy(apiBaseUrl, {
    upgradeInsecureRequests: publicDeployment,
    inlineElementNonce: developmentCspNonce,
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
      "import.meta.env.VITE_CARTO_BASEMAP_API_KEY": JSON.stringify(cartoBasemapApiKey),
    },
    html: developmentCspNonce ? { cspNonce: developmentCspNonce } : undefined,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
