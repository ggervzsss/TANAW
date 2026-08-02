import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getMlServiceCommand } from "../ml-service-command";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "../ml-service-contract";
import { classifyMlServiceStderr } from "../ml-service-log";
import { buildWindowsListenerPidScript, buildWindowsTerminateTreeArgs, shouldTerminateExternalService, waitForListenerRelease } from "../ml-service-process";
import { getCameraCredential, normalizeCameraCredentialId } from "../stores/camera-credential-store";

const desktopBuild = getDesktopBuildFingerprint();
const mlServicePort = Number(process.env["TANAW_ML_SERVICE_PORT"] ?? "8765");
const mlServiceUrl = `http://127.0.0.1:${mlServicePort}`;
const mlServiceAccessToken = randomBytes(32).toString("hex");
const ML_SERVICE_STARTUP_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);

let mlServiceProcess: ChildProcess | null = null;
let mlServiceError: string | null = null;
let mlServiceConnectedExternally = false;
let statusChangeListener: () => void = () => undefined;

function notifyStatusChange() {
  statusChangeListener();
}

export function setMlServiceStatusChangeListener(listener: () => void) {
  statusChangeListener = listener;
}

function getMlServiceDir() {
  const developmentPath = path.join(process.env.APP_ROOT, "ml-service");
  if (existsSync(developmentPath)) {
    return developmentPath;
  }

  return path.join(process.resourcesPath, "ml-service");
}

export async function startMlService() {
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
    notifyStatusChange();
    return;
  }
  if (existingService.reachable) {
    const listenerPid = await findMlServiceListenerPid();
    if (!listenerPid || !(await isLocalMlServiceProcess(listenerPid))) {
      mlServiceError = `Port ${mlServicePort} is serving an incompatible service that was not started from this TANAW workspace.`;
      notifyStatusChange();
      return;
    }
    console.info(`[tanaw-ml] Replacing incompatible local ML service process ${listenerPid}.`);
    await terminateProcessId(listenerPid, 3000);
    if ((await findMlServiceListenerPid()) !== null) {
      mlServiceError = `The incompatible local ML service on port ${mlServicePort} could not be stopped.`;
      notifyStatusChange();
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
      TANAW_ML_SERVICE_TOKEN: mlServiceAccessToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  mlServiceProcess = child;
  notifyStatusChange();

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
    notifyStatusChange();
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
    notifyStatusChange();
  });

  if (!(await waitForCompatibleMlService(ML_SERVICE_STARTUP_TIMEOUT_MS))) {
    mlServiceError = "The local ML service started but did not expose the required camera runtime API.";
    notifyStatusChange();
  }
}

async function stopMlService(waitMs = 0) {
  mlServiceConnectedExternally = false;
  if (!mlServiceProcess) {
    notifyStatusChange();
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

  notifyStatusChange();
}

export function isMlServiceRunning() {
  return Boolean(mlServiceProcess) || mlServiceConnectedExternally;
}

export async function getMlServiceStatusPayload() {
  return {
    baseUrl: mlServiceUrl,
    accessToken: mlServiceAccessToken,
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
      headers: mlServiceHeaders(),
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
      headers: mlServiceHeaders(),
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

export async function stopCameraProcessingFromTray() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    await fetch(`${mlServiceUrl}/cameras/stop`, { headers: mlServiceHeaders(), method: "POST", signal: controller.signal });
    mlServiceError = null;
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : "Unable to stop camera processing.";
  } finally {
    clearTimeout(timeout);
    notifyStatusChange();
  }
}

export async function requestCameraWithCredentials(scopeInput: unknown, cameraIdInput: unknown, operationInput: unknown, payloadInput: unknown) {
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
    headers: mlServiceHeaders({ "Content-Type": "application/json" }),
    method: "POST",
    signal: AbortSignal.timeout(operation === "start" ? 30_000 : 8000),
  });
  if (!response.ok) {
    throw new Error(`Camera ${operation} request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

function mlServiceHeaders(initial?: Record<string, string>) {
  return { ...initial, "X-TANAW-ML-Token": mlServiceAccessToken };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function restartMlService() {
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
    notifyStatusChange();
    return;
  }

  if (!(await isLocalMlServiceProcess(pid))) {
    mlServiceError = `A service is already listening on port ${mlServicePort}, but it was not started from this TANAW workspace.`;
    notifyStatusChange();
    return;
  }

  await terminateProcessId(pid, waitMs);
  notifyStatusChange();
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

export function getMlServiceSnapshot() {
  return { error: mlServiceError, running: isMlServiceRunning() };
}

export function recordMlServiceError(error: unknown) {
  mlServiceError = error instanceof Error ? error.message : String(error);
  notifyStatusChange();
}

export async function shutdownMlService() {
  if (isMlServiceRunning()) {
    await stopCameraProcessingFromTray();
  }
  if (shouldTerminateExternalService(mlServiceConnectedExternally, Boolean(mlServiceProcess))) {
    await stopExternalMlService(3000);
  } else {
    await stopMlService(3000);
  }
}
