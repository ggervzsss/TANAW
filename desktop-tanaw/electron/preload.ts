import { contextBridge, ipcRenderer } from "electron";

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },

  // You can expose other APTs you need here.
  // ...
});

contextBridge.exposeInMainWorld("tanawMlService", {
  getStatus() {
    return ipcRenderer.invoke("ml-service:get-status");
  },
  restart() {
    return ipcRenderer.invoke("ml-service:restart");
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
