import { describe, expect, it } from "vitest";
import { LOCAL_API_BASE_URL, buildContentSecurityPolicy, resolveApiBaseUrl, validateCoordinatedDeployment } from "./deployment.config";

describe("deployment origin configuration", () => {
  it("derives current Vercel/Render CSP and WebSocket origins", () => {
    const config = validateCoordinatedDeployment({
      apiBaseUrl: "https://tanaw.onrender.com",
      frontendPublicUrl: "https://tanaw-sanpedro.vercel.app",
      corsOrigins: "https://tanaw-sanpedro.vercel.app",
    });
    const policy = buildContentSecurityPolicy(config.apiBaseUrl, {
      upgradeInsecureRequests: true,
    });

    expect(config.frontendOrigin).toBe("https://tanaw-sanpedro.vercel.app");
    expect(config.connectSources).toEqual(["'self'", "https://tanaw.onrender.com", "wss://tanaw.onrender.com"]);
    expect(policy).toContain("connect-src 'self' https://tanaw.onrender.com wss://tanaw.onrender.com");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("switches cleanly to a future custom TANAW frontend and API domain", () => {
    const config = validateCoordinatedDeployment({
      apiBaseUrl: "https://api.tanaw-sanpedro.ph/v1/",
      frontendPublicUrl: "https://tanaw-sanpedro.ph/",
      corsOrigins: "https://tanaw-sanpedro.ph,https://operations.tanaw-sanpedro.ph",
    });
    const policy = buildContentSecurityPolicy(config.apiBaseUrl, {
      upgradeInsecureRequests: true,
    });

    expect(config.apiBaseUrl).toBe("https://api.tanaw-sanpedro.ph/v1");
    expect(config.frontendPublicUrl).toBe("https://tanaw-sanpedro.ph");
    expect(policy).toContain("connect-src 'self' https://api.tanaw-sanpedro.ph wss://api.tanaw-sanpedro.ph");
    expect(policy).not.toContain("onrender.com");
    expect(policy).not.toContain("vercel.app");
  });

  it("uses a local API only outside a public deployment", () => {
    expect(resolveApiBaseUrl(undefined, { publicDeployment: false })).toBe(LOCAL_API_BASE_URL);
    expect(() => resolveApiBaseUrl(undefined, { publicDeployment: true })).toThrow("VITE_API_BASE_URL is required");
    expect(() => resolveApiBaseUrl("http://localhost:8000", { publicDeployment: true })).toThrow("public HTTPS URL");
  });

  it("rejects a frontend origin missing from backend CORS", () => {
    expect(() =>
      validateCoordinatedDeployment({
        apiBaseUrl: "https://api.tanaw-sanpedro.ph",
        frontendPublicUrl: "https://tanaw-sanpedro.ph",
        corsOrigins: "https://another.example",
      }),
    ).toThrow("CORS_ORIGINS must include");
  });
});
