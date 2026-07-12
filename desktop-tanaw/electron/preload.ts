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
