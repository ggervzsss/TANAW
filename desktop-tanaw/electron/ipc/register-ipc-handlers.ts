import { ipcMain, type WebContents } from "electron";
import { clearAuthSession, loadAuthSession, saveAuthSession } from "../stores/auth-session-store";
import { loadCameraCredentials, removeCameraCredential, saveCameraCredential } from "../stores/camera-credential-store";

type IpcHandlerDependencies = {
  getMlServiceStatus: () => unknown | Promise<unknown>;
  isMainRenderer: (sender: WebContents) => boolean;
  markRendererReady: () => void;
  requestCamera: (scope: unknown, cameraId: unknown, operation: unknown, payload: unknown) => Promise<unknown>;
  restartMlService: () => Promise<void>;
  stopCamera: () => Promise<void>;
};

export function registerIpcHandlers(dependencies: IpcHandlerDependencies) {
  const requireMainRenderer = (sender: WebContents) => {
    if (!dependencies.isMainRenderer(sender)) {
      throw new Error("IPC request rejected from an untrusted renderer.");
    }
  };

  ipcMain.handle("ml-service:get-status", (event) => {
    requireMainRenderer(event.sender);
    return dependencies.getMlServiceStatus();
  });
  ipcMain.handle("ml-service:restart", async (event) => {
    requireMainRenderer(event.sender);
    await dependencies.restartMlService();
    return dependencies.getMlServiceStatus();
  });
  ipcMain.handle("ml-service:stop-camera", async (event) => {
    requireMainRenderer(event.sender);
    await dependencies.stopCamera();
    return dependencies.getMlServiceStatus();
  });

  ipcMain.handle("camera-credentials:load", (event, scope: unknown) => {
    requireMainRenderer(event.sender);
    return loadCameraCredentials(scope);
  });
  ipcMain.handle("camera-credentials:save", (event, scope: unknown, cameraId: unknown, credential: unknown) => {
    requireMainRenderer(event.sender);
    return saveCameraCredential(scope, cameraId, credential);
  });
  ipcMain.handle("camera-credentials:remove", (event, scope: unknown, cameraId: unknown) => {
    requireMainRenderer(event.sender);
    return removeCameraCredential(scope, cameraId);
  });
  ipcMain.handle("camera-credentials:request", (event, scope: unknown, cameraId: unknown, operation: unknown, payload: unknown) => {
    requireMainRenderer(event.sender);
    return dependencies.requestCamera(scope, cameraId, operation, payload);
  });

  ipcMain.handle("auth-session:load", (event) => {
    requireMainRenderer(event.sender);
    return loadAuthSession();
  });
  ipcMain.handle("auth-session:save", (event, session: unknown) => {
    requireMainRenderer(event.sender);
    return saveAuthSession(session);
  });
  ipcMain.handle("auth-session:clear", (event) => {
    requireMainRenderer(event.sender);
    return clearAuthSession();
  });
  ipcMain.on("startup:renderer-ready", (event) => {
    if (!dependencies.isMainRenderer(event.sender)) return;
    dependencies.markRendererReady();
  });
}
