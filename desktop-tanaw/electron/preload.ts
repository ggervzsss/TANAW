import { contextBridge, ipcRenderer } from "electron";
import type { MlOperation } from "./ml-ipc-contract";

contextBridge.exposeInMainWorld("tanawMlService", {
  getStatus() {
    return ipcRenderer.invoke("ml-service:get-status");
  },
  restart() {
    return ipcRenderer.invoke("ml-service:restart");
  },
  request(operation: MlOperation, payload?: unknown) {
    return ipcRenderer.invoke("ml-service:request", operation, payload);
  },
  onCameraEvent(listener: (event: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("ml-service:camera-event", handler);
    return () => ipcRenderer.removeListener("ml-service:camera-event", handler);
  },
  stopCamera() {
    return ipcRenderer.invoke("ml-service:stop-camera");
  },
});

contextBridge.exposeInMainWorld("tanawCameraCredentials", {
  save(scope: string, records: Record<string, { password?: string; username?: string }>, activeCameraBindings: Array<{ cameraId: number | string; cameraType: string; streamUrl: string }>) {
    return ipcRenderer.invoke("camera-credentials:save", scope, records, activeCameraBindings);
  },
});
