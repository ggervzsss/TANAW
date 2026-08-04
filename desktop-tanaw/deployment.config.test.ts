import { describe, expect, it } from "vitest";
import { LOCAL_DESKTOP_API_BASE_URL, PACKAGED_RENDERER_ENTRY_URL, PACKAGED_RENDERER_ORIGIN, resolveDesktopApiBaseUrl } from "./deployment.config";

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
});
