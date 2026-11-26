import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../../../../electron/ipc/register-ipc-handlers";
import { DESKTOP_APP_INFO_CHANNEL } from "../../../../src/types/desktop-app-info";

type Handler = (event: { sender: WebContents }, ...args: unknown[]) => unknown;

const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => electron.handlers.set(channel, handler),
    on: vi.fn(),
  },
}));

vi.mock("../../../../electron/stores/auth-session-store", () => ({
  cameraCredentialScopeForCurrentSession: vi.fn(),
  clearAuthSession: vi.fn(),
  loadAuthSession: vi.fn(),
  saveAuthSession: vi.fn(),
}));

vi.mock("../../../../electron/stores/camera-credential-store", () => ({
  loadCameraCredentials: vi.fn(),
  removeCameraCredential: vi.fn(),
  saveCameraCredential: vi.fn(),
}));

const mainRenderer = { id: 1 } as WebContents;
const otherRenderer = { id: 2 } as WebContents;

describe("app info bridge", () => {
  const getAppInfo = vi.fn(() => ({ version: "0.1.3", computerName: "FRONT-DESK-PC" }));

  beforeEach(() => {
    electron.handlers.clear();
    getAppInfo.mockClear();
    registerIpcHandlers({
      getAppInfo,
      getMlServiceStatus: vi.fn(),
      isMainRenderer: (sender) => sender === mainRenderer,
      markRendererReady: vi.fn(),
      requestCamera: vi.fn(),
      requestMlService: vi.fn(),
      restartMlService: vi.fn(),
      stopCamera: vi.fn(),
      subscribeToReportEvents: vi.fn(),
      unsubscribeFromReportEvents: vi.fn(),
    });
  });

  it("answers the app's own window with the version and computer name", async () => {
    const handler = electron.handlers.get(DESKTOP_APP_INFO_CHANNEL);
    expect(handler).toBeDefined();
    await expect(Promise.resolve(handler?.({ sender: mainRenderer }))).resolves.toEqual({ version: "0.1.3", computerName: "FRONT-DESK-PC" });
  });

  it("refuses any other renderer", () => {
    const handler = electron.handlers.get(DESKTOP_APP_INFO_CHANNEL);
    expect(() => handler?.({ sender: otherRenderer })).toThrow("untrusted renderer");
    expect(getAppInfo).not.toHaveBeenCalled();
  });
});
