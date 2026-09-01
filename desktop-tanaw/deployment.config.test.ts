import { describe, expect, it } from "vitest";
import {
  buildDesktopRendererContentSecurityPolicy,
  LOCAL_DESKTOP_API_BASE_URL,
  LOCAL_DESKTOP_RENDERER_ORIGIN,
  PACKAGED_RENDERER_ENTRY_URL,
  PACKAGED_RENDERER_ORIGIN,
  resolveDesktopApiBaseUrl,
} from "./deployment.config";

describe("desktop deployment configuration", () => {
  it("keeps the local backend fallback for development", () => {
    expect(resolveDesktopApiBaseUrl(undefined, { distributionBuild: false })).toBe(LOCAL_DESKTOP_API_BASE_URL);
    expect(resolveDesktopApiBaseUrl("http://127.0.0.1:8000/", { distributionBuild: false })).toBe("http://127.0.0.1:8000");
  });

  it("requires a public HTTPS backend for distribution builds", () => {
    expect(resolveDesktopApiBaseUrl("https://api.tanaw-sanpedro.ph/v1/", { distributionBuild: true })).toBe("https://api.tanaw-sanpedro.ph/v1");
    expect(() => resolveDesktopApiBaseUrl(undefined, { distributionBuild: true })).toThrow("required");
    expect(() => resolveDesktopApiBaseUrl("http://localhost:8000", { distributionBuild: true })).toThrow("public HTTPS URL");
    expect(() => resolveDesktopApiBaseUrl("https://192.168.1.20", { distributionBuild: true })).toThrow("public HTTPS URL");
  });

  it("defines one stable packaged renderer origin", () => {
    expect(PACKAGED_RENDERER_ORIGIN).toBe("tanaw-app://desktop");
    expect(PACKAGED_RENDERER_ENTRY_URL).toBe("tanaw-app://desktop/index.html");
  });

  it("allows only the configured production backend HTTP and WebSocket origins", () => {
    const policy = buildDesktopRendererContentSecurityPolicy("https://api.tanaw-sanpedro.ph/v1", { development: false });
    const connectSources = directiveSources(policy, "connect-src");

    expect(connectSources).toEqual(["'self'", "https://api.tanaw-sanpedro.ph", "wss://api.tanaw-sanpedro.ph"]);
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
    expect(connectSources).not.toContain("http://127.0.0.1:8765");
  });

  it("keeps the configured development backend and Vite HMR WebSocket functional", () => {
    const policy = buildDesktopRendererContentSecurityPolicy(LOCAL_DESKTOP_API_BASE_URL, { development: true });

    expect(directiveSources(policy, "connect-src")).toEqual(["'self'", "http://localhost:8000", "ws://localhost:8000", LOCAL_DESKTOP_RENDERER_ORIGIN.replace("http:", "ws:")]);
  });
});

function directiveSources(policy: string, directive: string): string[] {
  const value = policy
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${directive} `));
  if (!value) throw new Error(`Missing ${directive} directive.`);
  return value.split(/\s+/).slice(1);
}
