import { contextBridge, ipcRenderer } from "electron";
import { ML_REPORT_LIVE_EVENT_CHANNELS, type MlReportLiveEvent } from "../src/types/ml-report-live-events";

let startupRevealed = false;
const startupRevealListeners = new Set<() => void>();
const reportEventListeners = new Set<(event: MlReportLiveEvent) => void>();

const handleReportEvent = (_event: Electron.IpcRendererEvent, reportEvent: MlReportLiveEvent) => {
  for (const listener of reportEventListeners) listener(reportEvent);
};

ipcRenderer.on(ML_REPORT_LIVE_EVENT_CHANNELS.event, handleReportEvent);

window.addEventListener("unload", () => {
  if (reportEventListeners.size > 0) {
    ipcRenderer.send(ML_REPORT_LIVE_EVENT_CHANNELS.unsubscribe);
    reportEventListeners.clear();
  }
  ipcRenderer.removeListener(ML_REPORT_LIVE_EVENT_CHANNELS.event, handleReportEvent);
});

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
  subscribeToReportEvents(listener: (event: MlReportLiveEvent) => void) {
    if (reportEventListeners.size === 0) {
      ipcRenderer.send(ML_REPORT_LIVE_EVENT_CHANNELS.subscribe);
    }
    reportEventListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      reportEventListeners.delete(listener);
      if (reportEventListeners.size === 0) {
        ipcRenderer.send(ML_REPORT_LIVE_EVENT_CHANNELS.unsubscribe);
      }
    };
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
