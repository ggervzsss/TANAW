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
  save(scope: string, cameraId: number, credential: { password?: string; username: string }) {
    return ipcRenderer.invoke("camera-credentials:save", scope, cameraId, credential);
  },
  remove(scope: string, cameraId: number) {
    return ipcRenderer.invoke("camera-credentials:remove", scope, cameraId);
  },
  request(scope: string, cameraId: number, operation: "start" | "test", payload: Record<string, unknown>) {
    return ipcRenderer.invoke("camera-credentials:request", scope, cameraId, operation, payload);
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

contextBridge.exposeInMainWorld("tanawStartup", {
  ready() {
    ipcRenderer.send("startup:renderer-ready");
  },
});
