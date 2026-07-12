import process from "node:process";
import { validateCoordinatedDeployment } from "../deployment.config.ts";

try {
  const config = validateCoordinatedDeployment({
    apiBaseUrl: process.env.VITE_API_BASE_URL ?? "",
    frontendPublicUrl: process.env.FRONTEND_PUBLIC_URL ?? "",
    corsOrigins: process.env.CORS_ORIGINS ?? "",
  });
  console.log(
    JSON.stringify(
      {
        status: "valid",
        apiBaseUrl: config.apiBaseUrl,
        frontendPublicUrl: config.frontendPublicUrl,
        corsOrigins: config.corsOrigins,
        connectSources: config.connectSources,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Deployment configuration is invalid.");
  process.exitCode = 1;
}
