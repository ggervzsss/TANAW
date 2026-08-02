import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from "electron";
import { existsSync, statSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getMlServiceCommand } from "./ml-service-command";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "./ml-service-contract";
import { classifyMlServiceStderr } from "./ml-service-log";
import { buildWindowsListenerPidScript, buildWindowsTerminateTreeArgs, shouldTerminateExternalService, waitForListenerRelease } from "./ml-service-process";
import { createDisplayScaleController } from "./display-scale";
import { createStartupTransitionController, DEV_STARTUP_READY_FALLBACK_MS, type StartupRevealReason, type StartupTransitionController } from "./startup-transition";
import { getCameraCredential, normalizeCameraCredentialId } from "./stores/camera-credential-store";
import { registerIpcHandlers } from "./ipc/register-ipc-handlers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopBuild = getDesktopBuildFingerprint();

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
let mlServiceProcess: ChildProcess | null = null;
let mlServiceError: string | null = null;
let mlServiceConnectedExternally = false;
let isQuitting = false;
let mlServiceShutdownComplete = false;
let mlServiceShutdownPromise: Promise<void> | null = null;
let startupTransition: StartupTransitionController | null = null;

const mlServicePort = Number(process.env["TANAW_ML_SERVICE_PORT"] ?? "8765");
const mlServiceUrl = `http://127.0.0.1:${mlServicePort}`;
const TRAY_ICON_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNgi3f7TwlmGDVg1IBRA4aLAQAdsKoQzBu6fQAAAABJRU5ErkJggg==";
const ML_SERVICE_STARTUP_TIMEOUT_MS = 20_000;
const MAIN_WINDOW_BACKGROUND_COLOR = "#f4f8f5";
const SPLASH_WINDOW_BACKGROUND_COLOR = "#f7f7f3";
const execFileAsync = promisify(execFile);

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

function getMlServiceDir() {
  const developmentPath = path.join(process.env.APP_ROOT, "ml-service");
  if (existsSync(developmentPath)) {
    return developmentPath;
  }

  return path.join(process.resourcesPath, "ml-service");
}

async function startMlService() {
  if (isMlServiceRunning()) {
    return;
  }

  const serviceDir = getMlServiceDir();
  if (!existsSync(serviceDir)) {
    mlServiceError = `ML service directory was not found at ${serviceDir}.`;
    return;
  }

  const existingService = await probeMlServiceCompatibility();
  if (existingService.compatible) {
    mlServiceConnectedExternally = true;
    mlServiceError = null;
    updateTrayMenu();
    return;
  }
  if (existingService.reachable) {
    const listenerPid = await findMlServiceListenerPid();
    if (!listenerPid || !(await isLocalMlServiceProcess(listenerPid))) {
      mlServiceError = `Port ${mlServicePort} is serving an incompatible service that was not started from this TANAW workspace.`;
      updateTrayMenu();
      return;
    }
    console.info(`[tanaw-ml] Replacing incompatible local ML service process ${listenerPid}.`);
    await terminateProcessId(listenerPid, 3000);
    if ((await findMlServiceListenerPid()) !== null) {
      mlServiceError = `The incompatible local ML service on port ${mlServicePort} could not be stopped.`;
      updateTrayMenu();
      return;
    }
  }

  const { command, args } = getMlServiceCommand({ isPackaged: app.isPackaged, serviceDir });
  mlServiceError = null;
  mlServiceConnectedExternally = false;

  const child = spawn(command, args, {
    cwd: serviceDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      TANAW_APP_DATA_DIR: app.getPath("userData"),
      TANAW_ML_SERVICE_HOST: process.env["TANAW_ML_SERVICE_HOST"] ?? "127.0.0.1",
      TANAW_ML_SERVICE_PORT: String(mlServicePort),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  mlServiceProcess = child;
  updateTrayMenu();

  child.stdout?.on("data", (chunk) => {
    console.info(`[tanaw-ml] ${String(chunk).trim()}`);
  });

  child.stderr?.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (!message) {
      return;
    }
    console[classifyMlServiceStderr(message)](`[tanaw-ml] ${message}`);
  });

  child.on("error", (error) => {
    if (mlServiceProcess !== child) {
      return;
    }

    mlServiceError = error.message;
    mlServiceProcess = null;
    mlServiceConnectedExternally = false;
    updateTrayMenu();
  });

  child.on("exit", (code, signal) => {
    if (mlServiceProcess !== child) {
      return;
    }

    if (code && code !== 0) {
      mlServiceError = `ML service exited with code ${code}${signal ? ` (${signal})` : ""}.`;
    }
    mlServiceProcess = null;
    mlServiceConnectedExternally = false;
    updateTrayMenu();
  });

  if (!(await waitForCompatibleMlService(ML_SERVICE_STARTUP_TIMEOUT_MS))) {
    mlServiceError = "The local ML service started but did not expose the required camera runtime API.";
    updateTrayMenu();
  }
}

async function stopMlService(waitMs = 0) {
  mlServiceConnectedExternally = false;
  if (!mlServiceProcess) {
    updateTrayMenu();
    return;
  }

  const serviceProcess = mlServiceProcess;
  mlServiceProcess = null;
  const servicePid = serviceProcess.pid;

  if (process.platform === "win32" && servicePid) {
    await terminateProcessId(servicePid, Math.max(waitMs, 1500));
  } else {
    serviceProcess.kill();

    if (waitMs > 0) {
      const exited = await waitForProcessExit(serviceProcess, waitMs);
      if (!exited) {
        serviceProcess.kill("SIGKILL");
        await waitForProcessExit(serviceProcess, 1500);
      }
    }
  }

  updateTrayMenu();
}

function isMlServiceRunning() {
  return Boolean(mlServiceProcess) || mlServiceConnectedExternally;
}

async function getMlServiceStatusPayload() {
  return {
    baseUrl: mlServiceUrl,
    desktopBuild,
    desktopVersion: app.getVersion(),
    error: mlServiceError,
    packaged: app.isPackaged,
    pid: mlServiceProcess?.pid ?? (mlServiceConnectedExternally ? await findMlServiceListenerPid() : null),
    running: isMlServiceRunning(),
  };
}

function getDesktopBuildFingerprint() {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtime.toISOString();
  } catch {
    return "unknown";
  }
}

async function probeMlServiceCompatibility(timeoutMs = 1200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const healthResponse = await fetch(`${mlServiceUrl}/health`, {
      cache: "no-store",
      method: "GET",
      signal: controller.signal,
    });
    if (!healthResponse.ok) return { compatible: false, reachable: true };
    const health = (await healthResponse.json()) as unknown;
    if (!hasCompatibleMlHealth(health)) {
      return { compatible: false, reachable: true };
    }

    const runtimeResponse = await fetch(`${mlServiceUrl}/cameras/runtime`, {
      cache: "no-store",
      method: "GET",
      signal: controller.signal,
    });
    if (!runtimeResponse.ok) return { compatible: false, reachable: true };
    const runtime = (await runtimeResponse.json()) as unknown;
    const compatible = hasCompatibleCameraRuntime(runtime);
    return { compatible, reachable: true };
  } catch {
    return { compatible: false, reachable: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCompatibleMlService(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeMlServiceCompatibility()).compatible) {
      mlServiceError = null;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function stopCameraProcessingFromTray() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    await fetch(`${mlServiceUrl}/cameras/stop`, { method: "POST", signal: controller.signal });
    mlServiceError = null;
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : "Unable to stop camera processing.";
  } finally {
    clearTimeout(timeout);
    updateTrayMenu();
  }
}

async function requestCameraWithCredentials(scopeInput: unknown, cameraIdInput: unknown, operationInput: unknown, payloadInput: unknown) {
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const operation = operationInput === "test" || operationInput === "start" ? operationInput : null;
  if (!operation || !isObjectRecord(payloadInput)) {
    throw new Error("Unsupported secure camera request.");
  }
  const credentials = getCameraCredential(scopeInput, cameraIdInput);
  if (!credentials?.username) {
    throw new Error("Enter the camera username.");
  }
  if (!credentials?.password) {
    throw new Error("Enter the camera password.");
  }

  const payload = { ...payloadInput };
  delete payload.username;
  delete payload.password;
  payload.camera_id = Number(cameraId);
  payload.username = credentials?.username ?? null;
  payload.password = credentials?.password ?? null;

  const response = await fetch(`${mlServiceUrl}/camera/${operation}`, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(operation === "start" ? 30_000 : 8000),
  });
  if (!response.ok) {
    throw new Error(`Camera ${operation} request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function restartMlService() {
  if (mlServiceConnectedExternally && !mlServiceProcess) {
    await stopExternalMlService(3000);
  } else {
    await stopMlService(3000);
  }

  await startMlService();
}

async function stopExternalMlService(waitMs = 0) {
  const pid = await findMlServiceListenerPid();
  mlServiceConnectedExternally = false;

  if (!pid) {
    updateTrayMenu();
    return;
  }

  if (!(await isLocalMlServiceProcess(pid))) {
    mlServiceError = `A service is already listening on port ${mlServicePort}, but it was not started from this TANAW workspace.`;
    updateTrayMenu();
    return;
  }

  await terminateProcessId(pid, waitMs);
  updateTrayMenu();
}

async function findMlServiceListenerPid() {
  try {
    if (process.platform === "win32") {
      const script = buildWindowsListenerPidScript(mlServicePort);
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 3000, windowsHide: true });
      return parseProcessId(stdout);
    }

    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${mlServicePort}`, "-sTCP:LISTEN", "-t"], { timeout: 3000 });
    return parseProcessId(stdout);
  } catch {
    return null;
  }
}

function parseProcessId(output: string) {
  const pid = Number(output.trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function isLocalMlServiceProcess(pid: number) {
  const commandLine = await getProcessCommandLine(pid);
  if (!commandLine) {
    return false;
  }

  const serviceDir = normalizeProcessPath(getMlServiceDir());
  return normalizeProcessPath(commandLine).includes(serviceDir);
}

async function getProcessCommandLine(pid: number) {
  try {
    if (process.platform === "win32") {
      const script = `$proc = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($proc) { $proc.CommandLine }`;
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 3000, windowsHide: true });
      return stdout.trim() || null;
    }

    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], { timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function normalizeProcessPath(value: string) {
  return path.normalize(value).toLowerCase();
}

async function terminateProcessId(pid: number, waitMs: number) {
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill.exe", buildWindowsTerminateTreeArgs(pid), { timeout: Math.max(waitMs, 1500), windowsHide: true });
    } else {
      process.kill(pid);
    }
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : `Unable to stop ML service process ${pid}.`;
  }

  if (waitMs <= 0 || (await waitForMlServicePortRelease(waitMs))) {
    return;
  }

  try {
    if (process.platform === "win32") {
      const listenerPid = await findMlServiceListenerPid();
      if (listenerPid) {
        await execFileAsync("taskkill.exe", buildWindowsTerminateTreeArgs(listenerPid), { timeout: 1500, windowsHide: true });
      }
    } else {
      process.kill(pid, "SIGKILL");
    }
    await waitForMlServicePortRelease(1500);
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : `Unable to force stop ML service process ${pid}.`;
  }
}

async function waitForMlServicePortRelease(timeoutMs: number) {
  return waitForListenerRelease(findMlServiceListenerPid, timeoutMs);
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number) {
  if (process.exitCode !== null || process.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      process.off("exit", handleExit);
      process.off("error", handleError);
    };

    const handleExit = () => {
      cleanup();
      resolve(true);
    };

    const handleError = () => {
      cleanup();
      resolve(true);
    };

    process.once("exit", handleExit);
    process.once("error", handleError);
  });
}

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

  const monitoringLabel = isMlServiceRunning() ? "ML Service: Running" : mlServiceError ? "ML Service: Error" : "ML Service: Stopped";
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open TANAW", click: showMainWindow },
    { label: monitoringLabel, enabled: false },
    { type: "separator" },
    { label: "Stop Monitoring", enabled: isMlServiceRunning(), click: () => void stopCameraProcessingFromTray() },
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

function createSplashWindow() {
  const splashPath = getSplashPath();
  if (!existsSync(splashPath)) return false;

  const splash = new BrowserWindow({
    backgroundColor: SPLASH_WINDOW_BACKGROUND_COLOR,
    height: 900,
    icon: getWindowIcon(),
    minHeight: 500,
    minWidth: 800,
    show: false,
    title: "TANAW",
    width: 1440,
  });
  splashWindow = splash;

  splash.once("ready-to-show", () => {
    if (splash.isDestroyed() || startupTransition?.hasRevealed()) return;
    splash.maximize();
    splash.show();
    startupTransition?.markSplashVisible();
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

  const loadPromise = VITE_DEV_SERVER_URL ? win.loadURL(VITE_DEV_SERVER_URL) : win.loadFile(path.join(RENDERER_DIST, "index.html"));
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
    win?.maximize();
    showMainWindow();
    return;
  }
  startupTransition?.markMainReady();
}

function revealMainWindow(reason: StartupRevealReason) {
  if (!win || win.isDestroyed()) return;

  if (reason === "fallback") {
    console.warn("[tanaw] Renderer readiness timed out; revealing the main window using the startup fallback.");
  }

  win.maximize();
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
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: MAIN_WINDOW_BACKGROUND_COLOR,
    icon: getWindowIcon(),
    show: false,
    title: "TANAW Enterprise Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      backgroundThrottling: false,
    },
  });
  const targetWindow = win;
  // BrowserWindow.webContents throws once its native window has been destroyed.
  // Keep a stable reference so shutdown cleanup never reads that late getter.
  const targetWebContents = targetWindow.webContents;
  const displayScaleController = createDisplayScaleController({
    getScaleFactor: () => (targetWindow.isDestroyed() ? 1 : screen.getDisplayMatching(targetWindow.getBounds()).scaleFactor),
    getAppliedZoomFactor: () => (targetWebContents.isDestroyed() ? undefined : targetWebContents.getZoomFactor()),
    applyZoomFactor: (zoomFactor) => {
      if (!targetWindow.isDestroyed() && !targetWebContents.isDestroyed()) {
        targetWebContents.setZoomFactor(zoomFactor);
      }
    },
    subscribeToDisplayChanges: (listener) => {
      const handleDisplayMetricsChanged = () => listener();
      screen.on("display-metrics-changed", handleDisplayMetricsChanged);
      return () => screen.off("display-metrics-changed", handleDisplayMetricsChanged);
    },
    subscribeToWindowChanges: (listener) => {
      const handleWindowChange = () => listener();
      const handleZoomChange = (event: Electron.Event) => {
        event.preventDefault();
        listener();
      };
      targetWindow.on("move", handleWindowChange);
      targetWindow.on("resize", handleWindowChange);
      targetWebContents.on("zoom-changed", handleZoomChange);
      targetWebContents.on("did-finish-load", handleWindowChange);
      return () => {
        if (!targetWindow.isDestroyed()) {
          targetWindow.off("move", handleWindowChange);
          targetWindow.off("resize", handleWindowChange);
        }
        if (!targetWebContents.isDestroyed()) {
          targetWebContents.off("zoom-changed", handleZoomChange);
          targetWebContents.off("did-finish-load", handleWindowChange);
        }
      };
    },
  });
  displayScaleController.start();
  targetWebContents.once("destroyed", () => displayScaleController.dispose());

  win.once("ready-to-show", showWindowWhenReady);

  win.on("close", (event) => {
    if (isQuitting) {
      displayScaleController.dispose();
      return;
    }

    event.preventDefault();
    win?.hide();
    updateTrayMenu();
  });

  win.on("closed", () => {
    displayScaleController.dispose();
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
  if (!mlServiceShutdownPromise) {
    mlServiceShutdownPromise = (async () => {
      if (isMlServiceRunning()) {
        await stopCameraProcessingFromTray();
      }
      if (shouldTerminateExternalService(mlServiceConnectedExternally, Boolean(mlServiceProcess))) {
        await stopExternalMlService(3000);
      } else {
        await stopMlService(3000);
      }
    })();
  }
  return mlServiceShutdownPromise;
}

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
    registerIpcHandlers({
      getMlServiceStatus: getMlServiceStatusPayload,
      isMainRenderer: (sender) => Boolean(win && !win.isDestroyed() && sender === win.webContents),
      markRendererReady: () => startupTransition?.markRendererReady(),
      requestCamera: requestCameraWithCredentials,
      restartMlService,
      stopCamera: stopCameraProcessingFromTray,
    });
    createTray();

    const waitForSplash = existsSync(getSplashPath());
    startupTransition = createStartupTransitionController({
      fallbackMs: VITE_DEV_SERVER_URL ? DEV_STARTUP_READY_FALLBACK_MS : undefined,
      onReveal: revealMainWindow,
      waitForSplash,
    });

    if (waitForSplash && !createSplashWindow()) {
      startupTransition.skipSplash();
    }
    createWindow();

    void startMlService().catch((error) => {
      mlServiceError = error instanceof Error ? error.message : String(error);
      console.error("[tanaw] ML service could not be initialized in the background.", error);
      updateTrayMenu();
    });
  });
}
