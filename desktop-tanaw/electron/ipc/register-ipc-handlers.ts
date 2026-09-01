import { ipcMain, type WebContents } from "electron";
import { cameraCredentialScopeForCurrentSession, clearAuthSession, loadAuthSession, saveAuthSession } from "../stores/auth-session-store";
import { loadCameraCredentials, removeCameraCredential, saveCameraCredential } from "../stores/camera-credential-store";
import { ML_REPORT_LIVE_EVENT_CHANNELS } from "../../src/types/ml-report-live-events";

type IpcHandlerDependencies = {
  getMlServiceStatus: () => unknown | Promise<unknown>;
  isMainRenderer: (sender: WebContents) => boolean;
  markRendererReady: () => void;
  requestMlService: (request: unknown) => Promise<unknown>;
  requestCamera: (scope: string, cameraId: unknown, operation: unknown, payload: unknown) => Promise<unknown>;
  restartMlService: () => Promise<void>;
  stopCamera: () => Promise<void>;
  subscribeToReportEvents: (sender: WebContents) => void;
  unsubscribeFromReportEvents: (sender: WebContents) => void;
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
  ipcMain.handle("ml-service:request", (event, request: unknown) => {
    requireMainRenderer(event.sender);
    return dependencies.requestMlService(request);
  });
  ipcMain.on(ML_REPORT_LIVE_EVENT_CHANNELS.subscribe, (event) => {
    requireMainRenderer(event.sender);
    dependencies.subscribeToReportEvents(event.sender);
  });
  ipcMain.on(ML_REPORT_LIVE_EVENT_CHANNELS.unsubscribe, (event) => {
    requireMainRenderer(event.sender);
    dependencies.unsubscribeFromReportEvents(event.sender);
  });

  ipcMain.handle("camera-credentials:load", (event) => {
    requireMainRenderer(event.sender);
    return loadCameraCredentials(cameraCredentialScopeForCurrentSession());
  });
  ipcMain.handle("camera-credentials:save", (event, cameraId: unknown, credential: unknown) => {
    requireMainRenderer(event.sender);
    return saveCameraCredential(cameraCredentialScopeForCurrentSession(), cameraId, credential);
  });
  ipcMain.handle("camera-credentials:remove", (event, cameraId: unknown) => {
    requireMainRenderer(event.sender);
    return removeCameraCredential(cameraCredentialScopeForCurrentSession(), cameraId);
  });
  ipcMain.handle("camera-credentials:request", (event, cameraId: unknown, operation: unknown, payload: unknown) => {
    requireMainRenderer(event.sender);
    return dependencies.requestCamera(cameraCredentialScopeForCurrentSession(), cameraId, operation, payload);
  });

  ipcMain.handle("auth-session:load", (event) => {
    requireMainRenderer(event.sender);
    return loadAuthSession();
  });
  ipcMain.handle("auth-session:save", (event, session: unknown, persist: unknown) => {
    requireMainRenderer(event.sender);
    return saveAuthSession(session, persist === true);
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
