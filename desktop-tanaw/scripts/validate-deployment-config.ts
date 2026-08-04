import process from "node:process";
import { loadEnv } from "vite";
import { PACKAGED_RENDERER_ORIGIN, resolveDesktopApiBaseUrl } from "../deployment.config.ts";

try {
  const env = loadEnv("production", process.cwd(), "");
  const apiBaseUrl = resolveDesktopApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, {
    distributionBuild: true,
  });
  console.log(
    JSON.stringify(
      {
        status: "valid",
        apiBaseUrl,
        packagedRendererOrigin: PACKAGED_RENDERER_ORIGIN,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Desktop deployment configuration is invalid.");
  process.exitCode = 1;
}
