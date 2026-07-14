import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
const rendererServiceSource = readFileSync(new URL("../src/features/camera/services/ml-service.ts", import.meta.url), "utf8");
const credentialServiceSource = readFileSync(new URL("../src/features/camera/services/camera-credentials.ts", import.meta.url), "utf8");
const cameraManagementSource = readFileSync(new URL("../src/features/camera/components/CameraManagementView.tsx", import.meta.url), "utf8");
const pythonLauncherSource = readFileSync(new URL("../ml-service/main.py", import.meta.url), "utf8");
const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const rendererEntrySource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const rootReadmeSource = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const rootTldrSource = readFileSync(new URL("../../TLDR.md", import.meta.url), "utf8");

describe("Electron-to-ML trust-boundary source invariants", () => {
  it("does not expose the master capability, raw fetch, or credential reads in preload", () => {
    expect(preloadSource).not.toMatch(/capability|authorization|fetch\s*\(|shell|camera-credentials:load/i);
    expect(preloadSource).toContain('ipcRenderer.invoke("ml-service:request", operation, payload)');
    expect(preloadSource).toContain('ipcRenderer.invoke("camera-credentials:save"');
  });

  it("contains no renderer network path to the child service", () => {
    expect(rendererServiceSource).not.toMatch(/fetch\s*\(|new WebSocket|127\.0\.0\.1|localhost|8765/i);
    expect(rendererServiceSource).toContain("tanaw-ml://stream/");
    expect(rendererServiceSource).toContain("window.tanawMlService.request");
  });

  it("does not fall back to browser credential persistence", () => {
    expect(credentialServiceSource).not.toMatch(/localStorage|sessionStorage|\.load\s*\(/);
    expect(credentialServiceSource).toContain("window.tanawCameraCredentials.save");
    expect(rendererEntrySource).not.toMatch(/camera-credentials|localStorage|migrateLegacy/i);
    expect(mainSource).not.toMatch(/raw\.version === [12]|encoding === "plain"|Legacy plaintext/i);
    expect(mainSource).toContain('raw.version === 3 && raw.encoding === "safeStorage"');
  });

  it("does not probe or trust the old fixed ML port", () => {
    expect(mainSource).not.toMatch(/TANAW_ML_SERVICE_PORT|isMlServiceReachable|ConnectedExternally|127\.0\.0\.1:8765/);
    expect(pythonLauncherSource).toContain('listener.bind(("127.0.0.1", 0))');
    for (const documentation of [readmeSource, rootReadmeSource, rootTldrSource]) {
      expect(documentation).not.toMatch(/8765|TANAW_ML_SERVICE_(?:HOST|PORT)|curl\s+http:\/\/127\.0\.0\.1|Invoke-RestMethod\s+http:\/\/127\.0\.0\.1/i);
    }
    expect(readmeSource).toContain("operating-system-selected ephemeral loopback port");
  });

  it("locks renderer navigation, applies CSP, and validates main-frame IPC", () => {
    expect(mainSource).toContain('"Content-Security-Policy"');
    expect(mainSource).toContain("setWindowOpenHandler");
    expect(mainSource).toContain('on("will-navigate"');
    expect(mainSource).toContain("senderFrame !== win.webContents.mainFrame");
    expect(mainSource).toContain("tanaw-ml:");
    expect(mainSource).toContain("createReconnectableMlStream");
  });

  it("does not allow camera control payloads to carry credentials", () => {
    expect(rendererServiceSource).not.toMatch(/password:\s*camera\.password|username:\s*camera\.username/);
    expect(mainSource).toContain("payload.username = stored?.username ?? null");
    expect(mainSource).toContain("payload.password = stored?.password ?? null");
  });

  it("binds stored credentials to one exact camera connection", () => {
    expect(mainSource).toContain("credentialBindingMatches(stored, requestBinding)");
    expect(mainSource).toContain("Stored camera credentials are unavailable for this camera connection.");
    expect(credentialServiceSource).toContain("activeCameraBindings");
    expect(cameraManagementSource).toContain("stripStreamCredentials(camera.rtsp)");
  });

  it("rotates launch secrets and transfers bootstrap only through child stdin", () => {
    expect(mainSource).toContain('randomBytes(32).toString("base64url")');
    expect(mainSource).toContain("const launchId = randomUUID()");
    expect(mainSource).toContain("child.stdin?.end(");
    expect(mainSource).not.toMatch(/TANAW_(?:ML_)?(?:CAPABILITY|LAUNCH_ID)/);
  });
});
