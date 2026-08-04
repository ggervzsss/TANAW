import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGED_RENDERER_ENTRY_URL, resolvePackagedRendererAsset } from "./renderer-protocol";

describe("packaged renderer protocol", () => {
  const rendererDirectory = path.resolve("dist");

  it("maps the application entry point and bundled assets inside dist", () => {
    expect(resolvePackagedRendererAsset(PACKAGED_RENDERER_ENTRY_URL, rendererDirectory)).toBe(path.join(rendererDirectory, "index.html"));
    expect(resolvePackagedRendererAsset("tanaw-app://desktop/assets/index.js?v=1", rendererDirectory)).toBe(path.join(rendererDirectory, "assets", "index.js"));
  });

  it("rejects other origins, malformed escapes, and Windows path separators", () => {
    expect(resolvePackagedRendererAsset("https://desktop/index.html", rendererDirectory)).toBeNull();
    expect(resolvePackagedRendererAsset("tanaw-app://other/index.html", rendererDirectory)).toBeNull();
    expect(resolvePackagedRendererAsset("tanaw-app://desktop/%E0%A4%A", rendererDirectory)).toBeNull();
    expect(resolvePackagedRendererAsset("tanaw-app://desktop/..%5Csecret.txt", rendererDirectory)).toBeNull();
  });
});
