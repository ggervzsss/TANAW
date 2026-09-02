import { app, net, protocol } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createApplicationTray } from "./application-tray";
import { createApplicationWindows } from "./application-windows";
import { registerIpcHandlers } from "./ipc/register-ipc-handlers";
import { resolvePackagedRendererAsset } from "./renderer-protocol";
import {
  getMlServiceStatusPayload,
  proxyMlServiceJsonRequest,
  proxyMlServiceStream,
  recordMlServiceError,
  requestCameraWithCredentials,
  restartMlService,
  setMlServiceStatusChangeListener,
  shutdownMlService,
  startMlService,
  stopCameraProcessingFromTray,
  subscribeToMlReportLiveEvents,
  unsubscribeFromMlReportLiveEvents,
} from "./services/ml-service-supervisor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

let isQuitting = false;
let mlServiceShutdownComplete = false;
let mlServiceShutdownPromise: Promise<void> | null = null;

if (process.platform === "linux") {
  // TANAW's camera analysis runs in the Python ML service. Electron only renders
  // the UI, so disabling Chromium GPU paths on Linux avoids noisy VAAPI/X11 logs.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-features", "VaapiVideoDecoder,VaapiVideoEncoder");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: "tanaw-app", privileges: { codeCache: true, corsEnabled: true, secure: true, standard: true, supportFetchAPI: true } },
  { scheme: "tanaw-ml", privileges: { bypassCSP: false, secure: true, standard: true, stream: true, supportFetchAPI: true } },
]);

const windows = createApplicationWindows({
  devServerUrl: VITE_DEV_SERVER_URL,
  isQuitting: () => isQuitting,
  onMainWindowHidden: updateTrayMenu,
  preloadPath: path.join(__dirname, "preload.mjs"),
  publicDirectory: process.env.VITE_PUBLIC,
});

async function quitApplication() {
  isQuitting = true;
  windows.prepareForQuit();
  await shutdownMlServiceForQuit();
  mlServiceShutdownComplete = true;
  windows.destroyMainWindow();
  app.quit();
}

const trayController = createApplicationTray({
  onOpen: windows.showMainWindow,
  onQuit: quitApplication,
  publicDirectory: process.env.VITE_PUBLIC,
});

function updateTrayMenu() {
  trayController.update();
}

function shutdownMlServiceForQuit() {
  mlServiceShutdownPromise ??= shutdownMlService();
  return mlServiceShutdownPromise;
}

function registerApplicationProtocols() {
  if (!VITE_DEV_SERVER_URL) {
    protocol.handle("tanaw-app", (request) => {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const assetPath = resolvePackagedRendererAsset(request.url, RENDERER_DIST);
      return assetPath ? net.fetch(pathToFileURL(assetPath).toString()) : new Response("Not found", { status: 404 });
    });
  }
  protocol.handle("tanaw-ml", proxyMlServiceStream);
}

function registerApplicationIpc() {
  registerIpcHandlers({
    getMlServiceStatus: getMlServiceStatusPayload,
    isMainRenderer: windows.isMainRenderer,
    markRendererReady: windows.markRendererReady,
    requestCamera: requestCameraWithCredentials,
    requestMlService: proxyMlServiceJsonRequest,
    restartMlService,
    stopCamera: stopCameraProcessingFromTray,
    subscribeToReportEvents: subscribeToMlReportLiveEvents,
    unsubscribeFromReportEvents: unsubscribeFromMlReportLiveEvents,
  });
}

setMlServiceStatusChangeListener(trayController.update);

if (gotSingleInstanceLock) {
  app.on("window-all-closed", trayController.update);
  app.on("before-quit", (event) => {
    isQuitting = true;
    if (mlServiceShutdownComplete) return;
    event.preventDefault();
    void shutdownMlServiceForQuit().finally(() => {
      mlServiceShutdownComplete = true;
      app.quit();
    });
  });
  app.on("activate", windows.showMainWindow);
  app.on("second-instance", windows.showMainWindow);

  app.whenReady().then(() => {
    registerApplicationProtocols();
    registerApplicationIpc();
    trayController.create();
    windows.create();
    void startMlService().catch((error) => {
      recordMlServiceError(error);
      console.error("[tanaw] ML service could not be initialized in the background.", error);
      trayController.update();
    });
  });
}
