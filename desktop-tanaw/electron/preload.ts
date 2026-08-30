import { contextBridge, ipcRenderer } from "electron";

let startupRevealed = false;
const startupRevealListeners = new Set<() => void>();

ipcRenderer.on("startup:revealed", () => {
  startupRevealed = true;
  for (const listener of startupRevealListeners) listener();
  startupRevealListeners.clear();
});

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
  request(request: { body?: string; method: string; timeoutMs: number; url: string }) {
    return ipcRenderer.invoke("ml-service:request", request);
  },
});

contextBridge.exposeInMainWorld("tanawCameraCredentials", {
  load() {
    return ipcRenderer.invoke("camera-credentials:load");
  },
  save(cameraId: number, credential: { password?: string; username: string }) {
    return ipcRenderer.invoke("camera-credentials:save", cameraId, credential);
  },
  remove(cameraId: number) {
    return ipcRenderer.invoke("camera-credentials:remove", cameraId);
  },
  request(cameraId: number, operation: "start" | "test", payload: Record<string, unknown>) {
    return ipcRenderer.invoke("camera-credentials:request", cameraId, operation, payload);
  },
});

contextBridge.exposeInMainWorld("tanawAuthSession", {
  load() {
    return ipcRenderer.invoke("auth-session:load");
  },
  save(session: unknown, persist: boolean) {
    return ipcRenderer.invoke("auth-session:save", session, persist);
  },
  clear() {
    return ipcRenderer.invoke("auth-session:clear");
  },
});

contextBridge.exposeInMainWorld("tanawStartup", {
  onRevealed(listener: () => void) {
    if (startupRevealed) {
      listener();
      return () => undefined;
    }

    startupRevealListeners.add(listener);
    return () => {
      startupRevealListeners.delete(listener);
    };
  },
  ready() {
    ipcRenderer.send("startup:renderer-ready");
  },
});
