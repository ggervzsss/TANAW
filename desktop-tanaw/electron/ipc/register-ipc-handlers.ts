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
  ipcMain.handle("ml-service:get-status", dependencies.getMlServiceStatus);
  ipcMain.handle("ml-service:restart", async () => {
    await dependencies.restartMlService();
    return dependencies.getMlServiceStatus();
  });
  ipcMain.handle("ml-service:stop-camera", async () => {
    await dependencies.stopCamera();
    return dependencies.getMlServiceStatus();
  });

  ipcMain.handle("camera-credentials:load", (_event, scope: unknown) => loadCameraCredentials(scope));
  ipcMain.handle("camera-credentials:save", (_event, scope: unknown, cameraId: unknown, credential: unknown) => saveCameraCredential(scope, cameraId, credential));
  ipcMain.handle("camera-credentials:remove", (_event, scope: unknown, cameraId: unknown) => removeCameraCredential(scope, cameraId));
  ipcMain.handle("camera-credentials:request", (_event, scope: unknown, cameraId: unknown, operation: unknown, payload: unknown) => dependencies.requestCamera(scope, cameraId, operation, payload));

  ipcMain.handle("auth-session:load", loadAuthSession);
  ipcMain.handle("auth-session:save", (_event, session: unknown) => saveAuthSession(session));
  ipcMain.handle("auth-session:clear", clearAuthSession);
  ipcMain.on("startup:renderer-ready", (event) => {
    if (!dependencies.isMainRenderer(event.sender)) return;
    dependencies.markRendererReady();
  });
}
