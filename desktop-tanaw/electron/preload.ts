import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("tanawMlService", {
  getStatus() {
    return ipcRenderer.invoke("ml-service:get-status");
  },
  restart() {
    return ipcRenderer.invoke("ml-service:restart");
  },
  stopCamera() {
    return ipcRenderer.invoke("ml-service:stop-camera");
  },
});

contextBridge.exposeInMainWorld("tanawAppLifecycle", {
  getBackgroundStatus() {
    return ipcRenderer.invoke("app-lifecycle:get-background-status");
  },
  getStartupSettings() {
    return ipcRenderer.invoke("app-lifecycle:get-startup-settings");
  },
  quit() {
    return ipcRenderer.invoke("app-lifecycle:quit");
  },
  showWindow() {
    return ipcRenderer.invoke("app-lifecycle:show-window");
  },
  updateStartupSettings(openAtLogin: boolean) {
    return ipcRenderer.invoke("app-lifecycle:update-startup-settings", openAtLogin);
  },
});

contextBridge.exposeInMainWorld("tanawCameraCredentials", {
  load(scope: string) {
    return ipcRenderer.invoke("camera-credentials:load", scope);
  },
  save(scope: string, records: Record<string, { password?: string; username?: string }>) {
    return ipcRenderer.invoke("camera-credentials:save", scope, records);
  },
});

contextBridge.exposeInMainWorld("tanawAppEvents", {
  onMainProcessMessage(listener: (message: string) => void) {
    const handler = (_event: IpcRendererEvent, message: unknown) => {
      listener(String(message));
    };
    ipcRenderer.on("main-process-message", handler);
    return () => ipcRenderer.off("main-process-message", handler);
  },
});
