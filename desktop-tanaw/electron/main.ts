import { app, BrowserWindow, Menu, nativeImage, net, protocol, screen, Tray } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { createStartupTransitionController, DEV_STARTUP_READY_FALLBACK_MS, type StartupRevealReason, type StartupTransitionController } from "./startup-transition";
import { registerIpcHandlers } from "./ipc/register-ipc-handlers";
import { PACKAGED_RENDERER_ENTRY_URL, resolvePackagedRendererAsset } from "./renderer-protocol";
import {
  getMlServiceSnapshot,
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
} from "./services/ml-service-supervisor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure:
// dist/index.html
// dist-electron/main.js
// dist-electron/preload.mjs
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] to avoid the vite:define plugin.
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

let win: BrowserWindow | null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let mlServiceShutdownComplete = false;
let mlServiceShutdownPromise: Promise<void> | null = null;
let startupTransition: StartupTransitionController | null = null;

const TRAY_ICON_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNgi3f7TwlmGDVg1IBRA4aLAQAdsKoQzBu6fQAAAABJRU5ErkJggg==";
const MAIN_WINDOW_BACKGROUND_COLOR = "#f4f8f5";
const SPLASH_WINDOW_BACKGROUND_COLOR = "#f7f7f3";
const WINDOW_MAXIMIZE_SETTLE_MS = 80;
const WINDOW_MAXIMIZE_TIMEOUT_MS = 1000;

if (process.platform === "linux") {
  // TANAW's camera analysis runs in the Python ML service. Electron only renders
  // the UI, so disabling Chromium GPU paths on Linux avoids noisy VAAPI/X11 logs.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-features", "VaapiVideoDecoder,VaapiVideoEncoder");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: "tanaw-app", privileges: { codeCache: true, corsEnabled: true, secure: true, standard: true, supportFetchAPI: true } },
  { scheme: "tanaw-ml", privileges: { bypassCSP: false, secure: true, standard: true, stream: true, supportFetchAPI: true } },
]);

function createTray() {
  if (tray) return;

  try {
    const icon = getTrayIcon();
    if (icon.isEmpty()) {
      console.warn("[tanaw] Tray icon could not be loaded; continuing without a tray.");
      return;
    }

    tray = new Tray(icon);
    tray.setToolTip("TANAW Enterprise Desktop");
    tray.on("double-click", showMainWindow);
    updateTrayMenu();
  } catch (error) {
    console.error("[tanaw] Tray could not be created.", error);
    tray = null;
  }
}

function getTrayIcon() {
  const tanawIcon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, "favicon.png")).resize({ width: 16, height: 16 });
  if (!tanawIcon.isEmpty()) {
    return tanawIcon;
  }

  const icoIcon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, "favicon.ico")).resize({ width: 16, height: 16 });
  if (!icoIcon.isEmpty()) {
    return icoIcon;
  }

  const fallbackIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64")).resize({ width: 16, height: 16 });
  return fallbackIcon;
}

function getWindowIcon() {
  const pngIconPath = path.join(process.env.VITE_PUBLIC, "favicon.png");
  const tanawIcon = nativeImage.createFromPath(pngIconPath).resize({ width: 256, height: 256 });
  if (!tanawIcon.isEmpty()) {
    return tanawIcon;
  }

  const icoIconPath = path.join(process.env.VITE_PUBLIC, "favicon.ico");
  const icoIcon = nativeImage.createFromPath(icoIconPath).resize({ width: 256, height: 256 });
  if (!icoIcon.isEmpty()) {
    return icoIcon;
  }

  return nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"));
}

function updateTrayMenu() {
  if (!tray) return;

  const mlService = getMlServiceSnapshot();
  const monitoringLabel = mlService.running ? "ML Service: Running" : mlService.error ? "ML Service: Error" : "ML Service: Stopped";
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open TANAW", click: showMainWindow },
    { label: monitoringLabel, enabled: false },
    { type: "separator" },
    { label: "Stop Monitoring", enabled: mlService.running, click: () => void stopCameraProcessingFromTray() },
    { label: "Restart ML Service", click: () => void restartMlService() },
    { type: "separator" },
    { label: "Quit TANAW", click: () => void quitApplication() },
  ]);

  tray.setContextMenu(contextMenu);
}

function showMainWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }

  if (startupTransition && !startupTransition.hasRevealed()) {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
      splashWindow.focus();
    }
    return;
  }

  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}

function getSplashPath() {
  return path.join(process.env.VITE_PUBLIC, "splash.html");
}

function getStartupWindowBounds() {
  const { height, width, x, y } = screen.getPrimaryDisplay().workArea;
  return { height, width, x, y };
}

function prepareWindowForDisplay(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed() || targetWindow.isMaximized()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      targetWindow.removeListener("maximize", settleAfterMaximize);
      resolve();
    };
    const settleAfterMaximize = () => {
      if (settleTimer) return;
      settleTimer = setTimeout(finish, WINDOW_MAXIMIZE_SETTLE_MS);
    };

    targetWindow.once("maximize", settleAfterMaximize);
    timeoutTimer = setTimeout(finish, WINDOW_MAXIMIZE_TIMEOUT_MS);
    targetWindow.maximize();

    // Some Linux window managers update this state before emitting the event.
    if (targetWindow.isMaximized()) settleAfterMaximize();
  });
}

function createSplashWindow() {
  const splashPath = getSplashPath();
  if (!existsSync(splashPath)) return false;

  const splash = new BrowserWindow({
    backgroundColor: SPLASH_WINDOW_BACKGROUND_COLOR,
    icon: getWindowIcon(),
    minHeight: 500,
    minWidth: 800,
    show: false,
    title: "TANAW",
    ...getStartupWindowBounds(),
  });
  splashWindow = splash;

  splash.once("ready-to-show", async () => {
    if (splash.isDestroyed() || startupTransition?.hasRevealed()) return;
    await prepareWindowForDisplay(splash);
    if (splash.isDestroyed() || startupTransition?.hasRevealed()) return;
    splash.show();
    void splash.webContents
      .executeJavaScript("window.tanawSplash?.start?.()", true)
      .catch((error) => console.warn("[tanaw] Splash progress could not start cleanly.", error))
      .finally(() => startupTransition?.markSplashVisible());
  });
  splash.on("closed", () => {
    if (splashWindow === splash) splashWindow = null;
    startupTransition?.skipSplash();
  });

  void splash.loadFile(splashPath).catch((error) => {
    if (!isNavigationAbort(error)) {
      console.error("[tanaw] Splash screen could not be loaded.", error);
    }
    startupTransition?.skipSplash();
    if (!splash.isDestroyed()) splash.destroy();
  });
  return true;
}

function loadMainWindowContent() {
  if (!win || win.isDestroyed()) {
    return;
  }

  const loadPromise = win.loadURL(VITE_DEV_SERVER_URL ?? PACKAGED_RENDERER_ENTRY_URL);
  void loadPromise.catch((error) => {
    if (isNavigationAbort(error)) {
      return;
    }
    console.error("[tanaw] Main window could not be loaded.", error);
  });
}

function isNavigationAbort(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: unknown; errno?: unknown };
  return maybeError.code === "ERR_ABORTED" || maybeError.errno === -3;
}

function showWindowWhenReady() {
  if (startupTransition?.hasRevealed()) {
    void revealMainWindow("ready");
    return;
  }
  startupTransition?.markMainReady();
}

async function revealMainWindow(reason: StartupRevealReason) {
  if (!win || win.isDestroyed()) return;

  if (reason === "fallback") {
    console.warn("[tanaw] Renderer readiness timed out; revealing the main window using the startup fallback.");
  }

  if (splashWindow && !splashWindow.isDestroyed()) {
    await splashWindow.webContents
      .executeJavaScript("window.tanawSplash?.complete?.() ?? Promise.resolve()", true)
      .catch((error) => console.warn("[tanaw] Splash progress could not finish cleanly.", error));
  }

  if (!win || win.isDestroyed()) return;
  await prepareWindowForDisplay(win);
  if (!win || win.isDestroyed()) return;
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    showMainWindow();
    return;
  }

  win = new BrowserWindow({
    minWidth: 800,
    minHeight: 500,
    backgroundColor: MAIN_WINDOW_BACKGROUND_COLOR,
    icon: getWindowIcon(),
    show: false,
    title: "TANAW Enterprise Desktop",
    ...getStartupWindowBounds(),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: 1,
    },
  });
  // BrowserWindow.webContents throws once its native window has been destroyed.
  // Keep a stable reference so shutdown cleanup never reads that late getter.
  const targetWebContents = win.webContents;
  targetWebContents.setWindowOpenHandler(() => ({ action: "deny" }));
  targetWebContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", showWindowWhenReady);

  win.on("close", (event) => {
    if (isQuitting) return;

    event.preventDefault();
    win?.hide();
    updateTrayMenu();
  });

  win.on("closed", () => {
    win = null;
  });

  loadMainWindowContent();
}

async function quitApplication() {
  isQuitting = true;
  startupTransition?.dispose();
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }
  await shutdownMlServiceForQuit();
  mlServiceShutdownComplete = true;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  app.quit();
}

function shutdownMlServiceForQuit() {
  mlServiceShutdownPromise ??= shutdownMlService();
  return mlServiceShutdownPromise;
}

setMlServiceStatusChangeListener(updateTrayMenu);

if (gotSingleInstanceLock) {
  app.on("window-all-closed", () => {
    updateTrayMenu();
  });

  app.on("before-quit", (event) => {
    isQuitting = true;
    if (mlServiceShutdownComplete) {
      return;
    }

    event.preventDefault();
    void shutdownMlServiceForQuit().finally(() => {
      mlServiceShutdownComplete = true;
      app.quit();
    });
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    if (!VITE_DEV_SERVER_URL) {
      protocol.handle("tanaw-app", (request) => {
        if (request.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const assetPath = resolvePackagedRendererAsset(request.url, RENDERER_DIST);
        return assetPath ? net.fetch(pathToFileURL(assetPath).toString()) : new Response("Not found", { status: 404 });
      });
    }
    protocol.handle("tanaw-ml", proxyMlServiceStream);
    registerIpcHandlers({
      getMlServiceStatus: getMlServiceStatusPayload,
      isMainRenderer: (sender) => Boolean(win && !win.isDestroyed() && sender === win.webContents),
      markRendererReady: () => startupTransition?.markRendererReady(),
      requestCamera: requestCameraWithCredentials,
      requestMlService: proxyMlServiceJsonRequest,
      restartMlService,
      stopCamera: stopCameraProcessingFromTray,
    });
    createTray();

    const waitForSplash = existsSync(getSplashPath());
    startupTransition = createStartupTransitionController({
      fallbackMs: VITE_DEV_SERVER_URL ? DEV_STARTUP_READY_FALLBACK_MS : undefined,
      onReadyForReveal: () => {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        void splashWindow.webContents.executeJavaScript("window.tanawSplash?.ready?.()", true).catch((error) => console.warn("[tanaw] Splash readiness could not synchronize cleanly.", error));
      },
      onReveal: (reason) => void revealMainWindow(reason),
      waitForSplash,
    });

    if (waitForSplash && !createSplashWindow()) {
      startupTransition.skipSplash();
    }
    createWindow();

    void startMlService().catch((error) => {
      recordMlServiceError(error);
      console.error("[tanaw] ML service could not be initialized in the background.", error);
      updateTrayMenu();
    });
  });
}
