import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } from "electron";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getMlServiceCommand } from "./ml-service-command";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "./ml-service-contract";
import { buildWindowsListenerPidScript } from "./ml-service-process";
import { createDisplayScaleController } from "./display-scale";
import { normalizeCameraPassword, normalizeCameraUsername, resolveCameraCredential } from "./camera-credential-validation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopBuild = getDesktopBuildFingerprint();

// The built directory structure:
// dist/index.html
// dist-electron/main.js
// dist-electron/preload.mjs
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] to avoid the vite:define plugin.
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

let win: BrowserWindow | null;
let tray: Tray | null = null;
let mlServiceProcess: ChildProcess | null = null;
let mlServiceError: string | null = null;
let mlServiceConnectedExternally = false;
let isQuitting = false;

const mlServicePort = Number(process.env["TANAW_ML_SERVICE_PORT"] ?? "8765");
const mlServiceUrl = `http://127.0.0.1:${mlServicePort}`;
const CAMERA_CREDENTIAL_STORE_FILE = "camera-credentials.json";
const AUTH_SESSION_STORE_FILE = "auth-session.json";
const TRAY_ICON_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNgi3f7TwlmGDVg1IBRA4aLAQAdsKoQzBu6fQAAAABJRU5ErkJggg==";
const SPLASH_MIN_DISPLAY_MS = 1400;
const ML_SERVICE_STARTUP_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);

type CameraCredentialRecord = {
  password: string;
  username: string;
};

type CameraCredentialRecords = Record<string, CameraCredentialRecord>;
type CameraCredentialStore = Record<string, CameraCredentialRecords>;
type CameraCredentialMetadata = {
  passwordConfigured: boolean;
  username?: string;
};

type CameraCredentialStoreFile = {
  encoding: "safeStorage";
  payload: string;
  version: 1;
};

type StoredAuthSession = {
  token: string;
  user: Record<string, unknown>;
};

type AuthSessionStoreFile = {
  encoding: "safeStorage";
  payload: string;
  version: 1;
};

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
    if (await isMlServiceReachable(300)) {
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
    console.error(`[tanaw-ml] ${String(chunk).trim()}`);
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
  serviceProcess.kill();

  if (waitMs > 0) {
    const exited = await waitForProcessExit(serviceProcess, waitMs);
    if (!exited) {
      serviceProcess.kill("SIGKILL");
      await waitForProcessExit(serviceProcess, 1500);
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

async function isMlServiceReachable(timeoutMs = 750) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${mlServiceUrl}/health`, { method: "GET", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
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

function getCameraCredentialStorePath() {
  return path.join(app.getPath("userData"), CAMERA_CREDENTIAL_STORE_FILE);
}

function loadCameraCredentialStore(): CameraCredentialStore {
  const storePath = getCameraCredentialStorePath();
  if (!existsSync(storePath)) {
    return {};
  }

  try {
    const raw = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
    if (!isObjectRecord(raw) || raw.version !== 1) {
      return {};
    }

    if (raw.encoding === "safeStorage" && typeof raw.payload === "string") {
      if (!safeStorage.isEncryptionAvailable()) {
        return {};
      }
      const decrypted = safeStorage.decryptString(Buffer.from(raw.payload, "base64"));
      return normalizeCredentialStore(JSON.parse(decrypted) as unknown);
    }
  } catch {
    return {};
  }

  return {};
}

function saveCameraCredentialStore(store: CameraCredentialStore) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure camera credential storage is unavailable.");
  }
  const storePath = getCameraCredentialStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });

  const payload: CameraCredentialStoreFile = {
    encoding: "safeStorage",
    payload: safeStorage.encryptString(JSON.stringify(store)).toString("base64"),
    version: 1,
  };

  writeFileSync(storePath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
}

function loadCameraCredentials(scopeInput: unknown): Record<string, CameraCredentialMetadata> {
  const scope = normalizeCredentialScope(scopeInput);
  const store = loadCameraCredentialStore();
  return toCredentialMetadata(store[scope] ?? {});
}

function saveCameraCredential(scopeInput: unknown, cameraIdInput: unknown, credentialInput: unknown): CameraCredentialMetadata {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const store = loadCameraCredentialStore();
  const current = store[scope]?.[cameraId];
  const credential = resolveCameraCredential(credentialInput, current);
  store[scope] = { ...store[scope], [cameraId]: credential };
  saveCameraCredentialStore(store);
  return { passwordConfigured: true, username: credential.username };
}

function removeCameraCredential(scopeInput: unknown, cameraIdInput: unknown) {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const store = loadCameraCredentialStore();
  if (!store[scope]?.[cameraId]) return;
  delete store[scope][cameraId];
  if (Object.keys(store[scope]).length === 0) delete store[scope];
  saveCameraCredentialStore(store);
}

async function requestCameraWithCredentials(scopeInput: unknown, cameraIdInput: unknown, operationInput: unknown, payloadInput: unknown) {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const operation = operationInput === "test" || operationInput === "start" ? operationInput : null;
  if (!operation || !isObjectRecord(payloadInput)) {
    throw new Error("Unsupported secure camera request.");
  }
  const credentials = loadCameraCredentialStore()[scope]?.[cameraId];
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

function getAuthSessionStorePath() {
  return path.join(app.getPath("userData"), AUTH_SESSION_STORE_FILE);
}

function loadAuthSession(): StoredAuthSession | null {
  const storePath = getAuthSessionStorePath();
  if (!existsSync(storePath) || !safeStorage.isEncryptionAvailable()) return null;

  try {
    const raw = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
    if (!isObjectRecord(raw) || raw.version !== 1 || raw.encoding !== "safeStorage" || typeof raw.payload !== "string") return null;
    return normalizeAuthSession(JSON.parse(safeStorage.decryptString(Buffer.from(raw.payload, "base64"))) as unknown);
  } catch {
    return null;
  }
}

function saveAuthSession(sessionInput: unknown) {
  const session = normalizeAuthSession(sessionInput);
  if (!session || !safeStorage.isEncryptionAvailable()) return false;

  const storePath = getAuthSessionStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  const payload: AuthSessionStoreFile = {
    encoding: "safeStorage",
    payload: safeStorage.encryptString(JSON.stringify(session)).toString("base64"),
    version: 1,
  };
  writeFileSync(storePath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  return true;
}

function clearAuthSession() {
  const storePath = getAuthSessionStorePath();
  if (existsSync(storePath)) unlinkSync(storePath);
}

function normalizeAuthSession(value: unknown): StoredAuthSession | null {
  if (!isObjectRecord(value) || typeof value.token !== "string" || !value.token || !isObjectRecord(value.user)) return null;
  return { token: value.token, user: value.user };
}

function normalizeCredentialScope(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Camera credential scope is required.");
  }
  return value.trim().slice(0, 240);
}

function normalizeCameraCredentialId(value: unknown) {
  const cameraId = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(cameraId) || cameraId < 0) {
    throw new Error("A valid camera ID is required.");
  }
  return String(cameraId);
}

function toCredentialMetadata(records: CameraCredentialRecords): Record<string, CameraCredentialMetadata> {
  return Object.fromEntries(Object.entries(records).map(([cameraId, record]) => [cameraId, { passwordConfigured: Boolean(record.password), username: record.username }]));
}

function normalizeCredentialStore(value: unknown): CameraCredentialStore {
  if (!isObjectRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([scope, records]) => [normalizeCredentialScope(scope), normalizeCredentialRecords(records)] as const)
      .filter(([, records]) => Object.keys(records).length > 0),
  );
}

function normalizeCredentialRecords(value: unknown): CameraCredentialRecords {
  if (!isObjectRecord(value)) {
    return {};
  }

  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !isObjectRecord(record)) {
      continue;
    }

    const username = normalizeCameraUsername(record.username);
    const password = normalizeCameraPassword(record.password);
    if (Boolean(username) !== Boolean(password)) {
      throw new Error(`Camera ${cameraId} requires both username and password credentials.`);
    }
    if (username && password) {
      records[cameraId] = { password, username };
    }
  }
  return records;
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
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T"], { timeout: Math.max(waitMs, 1500), windowsHide: true });
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
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 1500, windowsHide: true });
    } else {
      process.kill(pid, "SIGKILL");
    }
    await waitForMlServicePortRelease(1500);
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : `Unable to force stop ML service process ${pid}.`;
  }
}

async function waitForMlServicePortRelease(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await isMlServiceReachable(250))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return false;
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

function registerMlServiceIpc() {
  ipcMain.handle("ml-service:get-status", () => getMlServiceStatusPayload());

  ipcMain.handle("ml-service:restart", async () => {
    await restartMlService();
    return getMlServiceStatusPayload();
  });

  ipcMain.handle("ml-service:stop-camera", async () => {
    await stopCameraProcessingFromTray();
    return getMlServiceStatusPayload();
  });
}

function registerCameraCredentialIpc() {
  ipcMain.handle("camera-credentials:load", (_event, scope: unknown) => loadCameraCredentials(scope));
  ipcMain.handle("camera-credentials:save", (_event, scope: unknown, cameraId: unknown, credential: unknown) => saveCameraCredential(scope, cameraId, credential));
  ipcMain.handle("camera-credentials:remove", (_event, scope: unknown, cameraId: unknown) => removeCameraCredential(scope, cameraId));
  ipcMain.handle("camera-credentials:request", (_event, scope: unknown, cameraId: unknown, operation: unknown, payload: unknown) => requestCameraWithCredentials(scope, cameraId, operation, payload));
}

function registerAuthSessionIpc() {
  ipcMain.handle("auth-session:load", () => loadAuthSession());
  ipcMain.handle("auth-session:save", (_event, session: unknown) => saveAuthSession(session));
  ipcMain.handle("auth-session:clear", () => clearAuthSession());
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

  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}

function loadSplashScreen() {
  if (!win || win.isDestroyed()) {
    return false;
  }
  const splashPath = path.join(process.env.VITE_PUBLIC, "splash.html");
  if (!existsSync(splashPath)) {
    return false;
  }

  void win.loadFile(splashPath).catch((error) => {
    if (isNavigationAbort(error)) {
      return;
    }
    console.error("[tanaw] Splash screen could not be loaded.", error);
    loadMainWindowContent();
  });
  return true;
}

async function waitForSplashMinimumDisplay(startedAt: number | null) {
  if (!startedAt) {
    return;
  }

  const remainingMs = SPLASH_MIN_DISPLAY_MS - (Date.now() - startedAt);
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
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
  if (!win || win.isDestroyed()) {
    return;
  }

  win.show();
}

function createWindow({ showSplash = false }: { showSplash?: boolean } = {}) {
  if (win && !win.isDestroyed()) {
    showMainWindow();
    return;
  }

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    icon: getWindowIcon(),
    show: false,
    title: "TANAW Enterprise Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
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
  win.maximize();

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

  if (showSplash && loadSplashScreen()) {
    return;
  }
  loadMainWindowContent();
}

async function quitApplication() {
  isQuitting = true;
  if (isMlServiceRunning()) {
    await stopCameraProcessingFromTray();
  }
  stopMlService();
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  app.quit();
}

if (gotSingleInstanceLock) {
  app.on("window-all-closed", () => {
    updateTrayMenu();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    void stopMlService();
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    let splashStartedAt: number | null = null;

    registerMlServiceIpc();
    registerCameraCredentialIpc();
    registerAuthSessionIpc();
    createTray();
    createWindow({ showSplash: true });
    splashStartedAt = Date.now();
    await startMlService();
    await waitForSplashMinimumDisplay(splashStartedAt);
    if (!win || win.isDestroyed()) {
      createWindow();
    } else {
      loadMainWindowContent();
    }
  });
}
