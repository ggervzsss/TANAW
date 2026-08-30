import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARTO_TILE_IMAGE_SOURCES } from "./map-tiles.config";
import { LOCAL_API_BASE_URL, TANAW_DESKTOP_ORIGIN, buildContentSecurityPolicy, resolveApiBaseUrl, resolveCartoBasemapApiKey, validateCoordinatedDeployment } from "./deployment.config";

type VercelHeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

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

  it("allows only TANAW's registered desktop origin alongside public web origins", () => {
    const config = validateCoordinatedDeployment({
      apiBaseUrl: "https://api.tanaw-sanpedro.ph",
      frontendPublicUrl: "https://tanaw-sanpedro.ph",
      corsOrigins: `https://tanaw-sanpedro.ph,${TANAW_DESKTOP_ORIGIN}`,
    });

    expect(config.corsOrigins).toEqual(["https://tanaw-sanpedro.ph", TANAW_DESKTOP_ORIGIN]);
    expect(() =>
      validateCoordinatedDeployment({
        apiBaseUrl: "https://api.tanaw-sanpedro.ph",
        frontendPublicUrl: "https://tanaw-sanpedro.ph",
        corsOrigins: "https://tanaw-sanpedro.ph,unknown-app://desktop",
      }),
    ).toThrow("HTTP or HTTPS");
  });

  it("uses a local API only outside a public deployment", () => {
    expect(resolveApiBaseUrl(undefined, { publicDeployment: false })).toBe(LOCAL_API_BASE_URL);
    expect(() => resolveApiBaseUrl(undefined, { publicDeployment: true })).toThrow("VITE_API_BASE_URL is required");
    expect(() => resolveApiBaseUrl("http://localhost:8000", { publicDeployment: true })).toThrow("public HTTPS URL");
  });

  it("requires a CARTO basemap key only for public deployments", () => {
    expect(resolveCartoBasemapApiKey(undefined, { publicDeployment: false })).toBe("");
    expect(resolveCartoBasemapApiKey(" carto-test-key ", { publicDeployment: true })).toBe("carto-test-key");
    expect(() => resolveCartoBasemapApiKey("", { publicDeployment: true })).toThrow("VITE_CARTO_BASEMAP_API_KEY is required");
  });

  it("uses a nonce for Vite development styles without weakening production styles", () => {
    const developmentPolicy = buildContentSecurityPolicy(LOCAL_API_BASE_URL, {
      inlineElementNonce: "development-test-nonce",
    });
    const productionPolicy = buildContentSecurityPolicy("https://tanaw.onrender.com", {
      upgradeInsecureRequests: true,
    });

    expect(developmentPolicy).toContain("style-src-elem 'self' 'nonce-development-test-nonce'");
    expect(developmentPolicy).toContain("script-src 'self' 'nonce-development-test-nonce'");
    expect(developmentPolicy).not.toContain("style-src-elem 'self' 'unsafe-inline'");
    expect(productionPolicy).toContain("style-src-elem 'self'");
    expect(productionPolicy).not.toContain("nonce-");
    expect(productionPolicy).not.toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("allows every CARTO tile subdomain used by Leaflet", () => {
    const policy = buildContentSecurityPolicy(LOCAL_API_BASE_URL);

    for (const source of CARTO_TILE_IMAGE_SOURCES) {
      expect(policy).toContain(source);
    }
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

  it("prevents activation and email-verification pages from leaking or caching secrets", () => {
    const config = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
      headers: VercelHeaderRule[];
    };
    const nginx = readFileSync(new URL("./nginx.conf", import.meta.url), "utf8");

    for (const route of ["/activate-account", "/verify-email-change"]) {
      const rule = config.headers.find((candidate) => candidate.source === route);
      expect(rule, `missing Vercel headers for ${route}`).toBeDefined();
      expect(rule?.headers).toContainEqual({
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate, private",
      });
      expect(rule?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
    }

    expect(nginx).toMatch(/location ~ \^\/\(activate-account\|verify-email-change\)\$/);
    expect(nginx).toContain('add_header Cache-Control "no-cache, no-store, must-revalidate, private" always;');
    expect(nginx).toContain('add_header Referrer-Policy "no-referrer" always;');
  });
});
