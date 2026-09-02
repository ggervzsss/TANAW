import { BrowserWindow, screen, type WebContents } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { getWindowIcon } from "./application-icons";
import { PACKAGED_RENDERER_ENTRY_URL } from "./renderer-protocol";
import { createStartupTransitionController, DEV_STARTUP_READY_FALLBACK_MS, type StartupRevealReason, type StartupTransitionController } from "./startup-transition";

const MAIN_WINDOW_BACKGROUND_COLOR = "#f4f8f5";
const SPLASH_WINDOW_BACKGROUND_COLOR = "#f7f7f3";
const WINDOW_MAXIMIZE_SETTLE_MS = 80;
const WINDOW_MAXIMIZE_TIMEOUT_MS = 1000;

type ApplicationWindowsOptions = {
  devServerUrl: string | undefined;
  isQuitting: () => boolean;
  onMainWindowHidden: () => void;
  preloadPath: string;
  publicDirectory: string;
};

export function createApplicationWindows({ devServerUrl, isQuitting, onMainWindowHidden, preloadPath, publicDirectory }: ApplicationWindowsOptions) {
  let mainWindow: BrowserWindow | null = null;
  let splashWindow: BrowserWindow | null = null;
  let startupTransition: StartupTransitionController | null = null;

  const getStartupWindowBounds = () => {
    const { height, width, x, y } = screen.getPrimaryDisplay().workArea;
    return { height, width, x, y };
  };

  const prepareWindowForDisplay = (targetWindow: BrowserWindow) => {
    if (targetWindow.isDestroyed() || targetWindow.isMaximized()) return Promise.resolve();
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
        if (!settleTimer) settleTimer = setTimeout(finish, WINDOW_MAXIMIZE_SETTLE_MS);
      };
      targetWindow.once("maximize", settleAfterMaximize);
      timeoutTimer = setTimeout(finish, WINDOW_MAXIMIZE_TIMEOUT_MS);
      targetWindow.maximize();
      if (targetWindow.isMaximized()) settleAfterMaximize();
    });
  };

  const isNavigationAbort = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const maybeError = error as { code?: unknown; errno?: unknown };
    return maybeError.code === "ERR_ABORTED" || maybeError.errno === -3;
  };

  const revealMainWindow = async (reason: StartupRevealReason) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (reason === "fallback") console.warn("[tanaw] Renderer readiness timed out; revealing the main window using the startup fallback.");
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript("window.tanawSplash?.complete?.() ?? Promise.resolve()", true).catch((error) => console.warn("[tanaw] Splash progress could not finish cleanly.", error));
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await prepareWindowForDisplay(mainWindow);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.webContents.send("startup:revealed");
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  };

  const createSplashWindow = () => {
    const splashPath = path.join(publicDirectory, "splash.html");
    if (!existsSync(splashPath)) return false;
    const splash = new BrowserWindow({
      backgroundColor: SPLASH_WINDOW_BACKGROUND_COLOR,
      icon: getWindowIcon(publicDirectory),
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
      void splash.webContents.executeJavaScript("window.tanawSplash?.start?.()", true).catch((error) => console.warn("[tanaw] Splash progress could not start cleanly.", error)).finally(() => startupTransition?.markSplashVisible());
    });
    splash.on("closed", () => {
      if (splashWindow === splash) splashWindow = null;
      startupTransition?.skipSplash();
    });
    void splash.loadFile(splashPath).catch((error) => {
      if (!isNavigationAbort(error)) console.error("[tanaw] Splash screen could not be loaded.", error);
      startupTransition?.skipSplash();
      if (!splash.isDestroyed()) splash.destroy();
    });
    return true;
  };

  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    if (startupTransition && !startupTransition.hasRevealed()) {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.show();
        splashWindow.focus();
      }
      return;
    }
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  };

  const createMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }
    const window = new BrowserWindow({
      minWidth: 800,
      minHeight: 500,
      backgroundColor: MAIN_WINDOW_BACKGROUND_COLOR,
      icon: getWindowIcon(publicDirectory),
      show: false,
      title: "TANAW Enterprise Desktop",
      ...getStartupWindowBounds(),
      webPreferences: {
        preload: preloadPath,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        zoomFactor: 1,
      },
    });
    mainWindow = window;
    const targetWebContents = window.webContents;
    targetWebContents.setWindowOpenHandler(() => ({ action: "deny" }));
    targetWebContents.on("will-navigate", (event) => event.preventDefault());
    targetWebContents.on("did-finish-load", () => {
      if (startupTransition?.hasRevealed()) targetWebContents.send("startup:revealed");
    });
    window.once("ready-to-show", () => {
      if (startupTransition?.hasRevealed()) void revealMainWindow("ready");
      else startupTransition?.markMainReady();
    });
    window.on("close", (event) => {
      if (isQuitting()) return;
      event.preventDefault();
      window.hide();
      onMainWindowHidden();
    });
    window.on("closed", () => {
      if (mainWindow === window) mainWindow = null;
    });
    void window.loadURL(devServerUrl ?? PACKAGED_RENDERER_ENTRY_URL).catch((error) => {
      if (!isNavigationAbort(error)) console.error("[tanaw] Main window could not be loaded.", error);
    });
  };

  const create = () => {
    const splashPath = path.join(publicDirectory, "splash.html");
    const waitForSplash = existsSync(splashPath);
    startupTransition = createStartupTransitionController({
      fallbackMs: devServerUrl ? DEV_STARTUP_READY_FALLBACK_MS : undefined,
      onReadyForReveal: () => {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        void splashWindow.webContents.executeJavaScript("window.tanawSplash?.ready?.()", true).catch((error) => console.warn("[tanaw] Splash readiness could not synchronize cleanly.", error));
      },
      onReveal: (reason) => void revealMainWindow(reason),
      waitForSplash,
    });
    if (waitForSplash && !createSplashWindow()) startupTransition.skipSplash();
    createMainWindow();
  };

  const prepareForQuit = () => {
    startupTransition?.dispose();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  };

  const destroyMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  };

  return {
    create,
    destroyMainWindow,
    isMainRenderer: (sender: WebContents) => Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents),
    markRendererReady: () => startupTransition?.markRendererReady(),
    prepareForQuit,
    showMainWindow,
  };
}
