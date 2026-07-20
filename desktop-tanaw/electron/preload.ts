import { contextBridge, ipcRenderer } from "electron";

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

contextBridge.exposeInMainWorld("tanawCameraCredentials", {
  load(scope: string) {
    return ipcRenderer.invoke("camera-credentials:load", scope);
  },
  save(scope: string, records: Record<string, { password?: string; username?: string }>) {
    return ipcRenderer.invoke("camera-credentials:save", scope, records);
  },
});

contextBridge.exposeInMainWorld("tanawAuthSession", {
  load() {
    return ipcRenderer.invoke("auth-session:load");
  },
  save(session: unknown) {
    return ipcRenderer.invoke("auth-session:save", session);
  },
  clear() {
    return ipcRenderer.invoke("auth-session:clear");
  },
});
