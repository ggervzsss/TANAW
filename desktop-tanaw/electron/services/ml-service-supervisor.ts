import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getMlServiceCommand } from "../ml-service-command";
import { validateMlServiceRequest, type ValidatedMlServiceRequest } from "../ml-service-request-policy";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "../ml-service-contract";
import { classifyMlServiceStderr } from "../ml-service-log";
import { createMlDiagnosticLog, createMlDiagnosticOutput } from "../ml-service-diagnostics";
import {
  buildWindowsListenerPidScript,
  buildWindowsProcessInfoScript,
  buildWindowsTerminateTreeArgs,
  isWorkspaceProcess,
  parseProcessInfo,
  shouldTerminateExternalService,
  waitForListenerRelease,
} from "../ml-service-process";
import { getCameraCredential, normalizeCameraCredentialId } from "../stores/camera-credential-store";
import {
  forgetAllCounting,
  forgetCountingCamera,
  keepCountingCameras,
  listCountingIntents,
  rememberCountingStart,
  updateCountingPerformance,
} from "../stores/camera-counting-intent-store";
import { resolveCameraRequestCredential } from "../camera-credential-validation";
import { SerializedOperationQueue } from "./serialized-operation-queue";
import { MlReportLiveEventStream } from "./ml-report-live-events";
import { createCountingPowerGuard } from "./counting-power-guard";

const desktopBuild = getDesktopBuildFingerprint();
const mlServicePort = Number(process.env["TANAW_ML_SERVICE_PORT"] ?? (app.isPackaged ? "8766" : "8765"));
const mlServiceUrl = `http://127.0.0.1:${mlServicePort}`;
const mlServiceAccessToken = randomBytes(32).toString("hex");
const ML_SERVICE_STARTUP_TIMEOUT_MS = 90_000;
const execFileAsync = promisify(execFile);
const lifecycleOperations = new SerializedOperationQueue();
const reportLiveEvents = new MlReportLiveEventStream({
  accessToken: mlServiceAccessToken,
  baseUrl: mlServiceUrl,
});

/** Waits before restarting a service that exited unexpectedly, growing with repeated crashes. */
export const ML_SERVICE_CRASH_RESTART_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
/** A service that stayed up this long before crashing restarts from the shortest delay again. */
const ML_SERVICE_STABLE_RUN_MS = 5 * 60_000;
/** How often cameras that should be counting but are not (offline at start, failed) are retried. */
export const COUNTING_RESUME_INTERVAL_MS = 60_000;

let mlServiceProcess: ChildProcess | null = null;
let mlServiceError: string | null = null;
let mlServiceConnectedExternally = false;
let statusChangeListener: () => void = () => undefined;
// The last enterprise the signed-in user bound; a restarted service is bound to it again so
// counting and reports keep working without signing in again.
let lastEnterpriseContext: ValidatedMlServiceRequest | null = null;
let crashRestartTimer: ReturnType<typeof setTimeout> | null = null;
let crashRestartAttempts = 0;
let mlServiceReadyAt = 0;
let shuttingDown = false;
let resumeTimer: ReturnType<typeof setInterval> | null = null;
let resuming: Promise<void> | null = null;

const countingPowerGuard = createCountingPowerGuard(async () => {
  if (!isMlServiceRunning()) return false;
  const response = await fetch(`${mlServiceUrl}/cameras/runtime`, {
    cache: "no-store",
    headers: mlServiceHeaders(),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) return false;
  const runtime = (await response.json()) as { active_camera_count?: number; pending_camera_ids?: unknown[] };
  return (runtime.active_camera_count ?? 0) > 0 || (runtime.pending_camera_ids?.length ?? 0) > 0;
});

function notifyStatusChange() {
  statusChangeListener();
}

export function setMlServiceStatusChangeListener(listener: () => void) {
  statusChangeListener = listener;
}

function getMlServiceDir() {
  return path.join(app.isPackaged ? process.resourcesPath : process.env.APP_ROOT, "ml-service");
}

export function startMlService() {
  return lifecycleOperations.run(startMlServiceUnlocked);
}

async function startMlServiceUnlocked() {
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
    reportLiveEvents.reconnectAfterServiceRestart();
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
  const diagnostic = createMlDiagnosticLog(path.join(app.getPath("userData"), "logs"));
  diagnostic.write(`Starting ML service: desktop=${app.getVersion()} platform=${process.platform} arch=${process.arch} runtime=${command}`);
  mlServiceError = null;
  mlServiceConnectedExternally = false;

  const child = spawn(command, args, {
    cwd: serviceDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      TANAW_APP_DATA_DIR: app.getPath("userData"),
      TANAW_ML_SERVICE_HOST: process.env["TANAW_ML_SERVICE_HOST"] ?? "127.0.0.1",
      TANAW_ML_MODEL_DIR: path.join(serviceDir, "models"),
      TANAW_ML_SERVICE_PORT: String(mlServicePort),
      TANAW_ML_SERVICE_TOKEN: mlServiceAccessToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  mlServiceProcess = child;
  notifyStatusChange();

  const stdout = createMlDiagnosticOutput((message) => {
    diagnostic.write(message);
    console.info(`[tanaw-ml] ${message}`);
  });
  const stderr = createMlDiagnosticOutput((message) => {
    diagnostic.write(message);
    console[classifyMlServiceStderr(message)](`[tanaw-ml] ${message}`);
  });
  child.stdout?.on("data", stdout.push);
  child.stderr?.on("data", stderr.push);
  child.on("close", () => {
    stdout.flush();
    stderr.flush();
  });

  child.on("error", (error) => {
    if (mlServiceProcess !== child) {
      return;
    }

    mlServiceError = error.message;
    diagnostic.write(`ML service launch failed: ${error.message}`);
    mlServiceProcess = null;
    mlServiceConnectedExternally = false;
    notifyStatusChange();
  });

  child.on("exit", (code, signal) => {
    if (mlServiceProcess !== child) {
      return;
    }

    const exit = code === null ? `signal ${signal ?? "unknown"}` : `code ${code} (0x${(code >>> 0).toString(16)})`;
    mlServiceError = `ML service exited with ${exit}. Details: ${diagnostic.file}`;
    diagnostic.write(mlServiceError);
    mlServiceProcess = null;
    mlServiceConnectedExternally = false;
    notifyStatusChange();
    void countingPowerGuard.refresh();
    // An intentional stop clears mlServiceProcess first, so reaching here means a crash.
    scheduleCrashRestart(diagnostic.write);
  });

  if (!(await waitForCompatibleMlService(ML_SERVICE_STARTUP_TIMEOUT_MS, () => mlServiceProcess === child))) {
    // A process launch/crash error is more useful than a generic timeout.
    if (mlServiceProcess !== child) return;
    mlServiceError = "The local ML service started but did not expose the required camera runtime API.";
    diagnostic.write(mlServiceError);
    notifyStatusChange();
  } else {
    diagnostic.write("ML service is ready.");
    mlServiceReadyAt = Date.now();
    reportLiveEvents.reconnectAfterServiceRestart();
    countingPowerGuard.start();
    resumeTimer ??= setInterval(() => void resumeCounting(), COUNTING_RESUME_INTERVAL_MS);
  }
}

function currentEnterpriseId() {
  try {
    const body = JSON.parse(lastEnterpriseContext?.body ?? "null") as { enterprise_id?: unknown } | null;
    return typeof body?.enterprise_id === "string" && body.enterprise_id.trim() ? body.enterprise_id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Start every camera the operator left counting that is not counting now.
 *
 * Runs after the service starts or is rebound, and periodically, so a crash, a reboot, or a
 * camera that was unreachable when it was started does not leave visitors uncounted.
 */
export function resumeCounting() {
  resuming ??= resumeCountingNow().finally(() => {
    resuming = null;
  });
  return resuming;
}

async function resumeCountingNow() {
  const enterpriseId = currentEnterpriseId();
  if (!enterpriseId || shuttingDown || !isMlServiceRunning() || mlServiceError) return;
  const intents = listCountingIntents(enterpriseId);
  if (!intents.length) return;
  try {
    const [runtime, profiles] = await Promise.all([getMlServiceJson("/cameras/runtime"), getMlServiceJson("/cameras")]);
    const states = runtime as { enterprise_id?: string; cameras?: Array<{ camera_id?: number; counts?: { running?: boolean } }>; pending_camera_ids?: number[] };
    if (states.enterprise_id !== enterpriseId || !Array.isArray(profiles)) return;
    const configured = new Set(profiles.map((profile) => String((profile as { id?: unknown }).id)));
    keepCountingCameras(enterpriseId, configured);
    const counting = new Set([
      ...(states.cameras ?? []).filter((camera) => camera.counts?.running).map((camera) => String(camera.camera_id)),
      ...(states.pending_camera_ids ?? []).map(String),
    ]);
    for (const intent of intents) {
      if (!configured.has(intent.cameraId) || counting.has(intent.cameraId)) continue;
      try {
        await requestCameraWithCredentials(intent.scope, intent.cameraId, "start", intent.payload);
      } catch (error) {
        console.warn(`[tanaw-ml] Camera ${intent.cameraId} could not resume counting; retrying later.`, error);
      }
    }
  } catch (error) {
    console.warn("[tanaw-ml] Camera counting could not be resumed; retrying later.", error);
  }
}

async function getMlServiceJson(pathname: string): Promise<unknown> {
  const response = await fetch(`${mlServiceUrl}${pathname}`, { cache: "no-store", headers: mlServiceHeaders(), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ML service request ${pathname} failed (${response.status}).`);
  return response.json() as Promise<unknown>;
}

/** Keep the remembered counting cameras in step with what the operator just did. */
function followCountingChanges(request: ValidatedMlServiceRequest, responseBody: string) {
  const enterpriseId = currentEnterpriseId();
  if (!enterpriseId) return;
  const { pathname } = request.url;
  const stopped = /^\/camera\/(\d+)\/stop$/.exec(pathname);
  if (request.method === "POST" && stopped) forgetCountingCamera(enterpriseId, stopped[1]);
  else if (request.method === "POST" && pathname === "/cameras/stop") forgetAllCounting(enterpriseId);
  else if (request.method === "PUT" && pathname === "/cameras") {
    try {
      const profiles = JSON.parse(responseBody) as Array<{ id?: unknown }>;
      if (Array.isArray(profiles)) keepCountingCameras(enterpriseId, new Set(profiles.map((profile) => String(profile.id))));
    } catch {
      // An unreadable answer leaves the list as it was.
    }
  } else if (request.method === "POST" && pathname === "/cameras/performance-profile") {
    try {
      updateCountingPerformance(enterpriseId, JSON.parse(request.body ?? "{}") as Record<string, unknown>);
    } catch {
      // A malformed request body was rejected by the service as well.
    }
  }
}

function scheduleCrashRestart(log: (message: string) => void) {
  if (shuttingDown || crashRestartTimer) return;
  if (mlServiceReadyAt && Date.now() - mlServiceReadyAt >= ML_SERVICE_STABLE_RUN_MS) crashRestartAttempts = 0;
  const delay = ML_SERVICE_CRASH_RESTART_DELAYS_MS[Math.min(crashRestartAttempts, ML_SERVICE_CRASH_RESTART_DELAYS_MS.length - 1)];
  crashRestartAttempts += 1;
  log(`Restarting the ML service in ${Math.round(delay / 1000)} seconds.`);
  crashRestartTimer = setTimeout(() => {
    crashRestartTimer = null;
    void lifecycleOperations
      .run(async () => {
        if (shuttingDown || isMlServiceRunning()) return;
        await startMlServiceUnlocked();
        await rebindEnterpriseContext();
      })
      .catch((error: unknown) => recordMlServiceError(error));
  }, delay);
}

/** Bind a freshly started service to the signed-in enterprise again. */
async function rebindEnterpriseContext() {
  if (!lastEnterpriseContext || !isMlServiceRunning() || mlServiceError) return;
  try {
    const response = await sendMlServiceJsonRequest(lastEnterpriseContext);
    if (response.ok) {
      reportLiveEvents.reconnectAfterServiceRestart();
      setTimeout(() => void resumeCounting(), 0);
    } else mlServiceError = `The restarted ML service could not reopen this establishment (${response.status}).`;
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : "The restarted ML service could not reopen this establishment.";
  }
  notifyStatusChange();
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
  // A slow first launch can become healthy after the initial deadline. Clear
  // the startup error only after checking the actual authenticated API.
  if (mlServiceError && isMlServiceRunning() && (await probeMlServiceCompatibility()).compatible) {
    mlServiceError = null;
    reportLiveEvents.reconnectAfterServiceRestart();
    notifyStatusChange();
  }
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

export async function proxyMlServiceJsonRequest(requestInput: unknown) {
  const request = validateMlServiceRequest(requestInput, mlServiceUrl);
  if (request.method !== "POST" || request.url.pathname !== "/context/enterprise") {
    const response = await sendMlServiceJsonRequest(request);
    if (response.ok) followCountingChanges(request, response.body);
    if (request.method === "POST" && /^\/cameras?\/(\d+\/)?stop$/.test(request.url.pathname)) void countingPowerGuard.refresh();
    return response;
  }

  // Sign-in can finish while the native service is still starting. Keep the
  // first enterprise binding behind startup and any in-progress restart.
  return lifecycleOperations.run(async () => {
    await startMlServiceUnlocked();
    const status = await getMlServiceStatusPayload();
    if (status.error || !status.running) {
      return {
        body: JSON.stringify({ code: "service_unavailable", message: status.error ?? "The local ML service could not start." }),
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      };
    }
    const response = await sendMlServiceJsonRequest(request);
    if (response.ok) {
      lastEnterpriseContext = request;
      reportLiveEvents.reconnectAfterServiceRestart();
      setTimeout(() => void resumeCounting(), 0);
    }
    return response;
  });
}

async function sendMlServiceJsonRequest({ body, method, timeoutMs, url }: ValidatedMlServiceRequest) {
  const response = await fetch(url, {
    body,
    cache: "no-store",
    headers: mlServiceHeaders(body ? { "Content-Type": "application/json" } : undefined),
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    body: await response.text(),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

export function subscribeToMlReportLiveEvents(sender: Parameters<MlReportLiveEventStream["subscribe"]>[0]) {
  reportLiveEvents.subscribe(sender);
}

export function unsubscribeFromMlReportLiveEvents(sender: Parameters<MlReportLiveEventStream["unsubscribe"]>[0]) {
  reportLiveEvents.unsubscribe(sender);
}

export async function proxyMlServiceStream(request: Request) {
  const source = new URL(request.url);
  const match = /^\/camera\/(\d+)\/stream$/.exec(source.pathname);
  if (!match) return new Response("Not found", { status: 404 });
  const upstream = new URL(`/camera/${match[1]}/stream`, mlServiceUrl);
  upstream.search = source.search;
  const response = await fetch(upstream, {
    cache: "no-store",
    headers: mlServiceHeaders(),
    signal: request.signal,
  });
  if (response.ok && response.headers.get("X-TANAW-Stream-Frames") !== "live-only") {
    await response.body?.cancel();
    return new Response("Incompatible camera stream. Update or restart the TANAW ML service.", { status: 502 });
  }
  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
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

async function waitForCompatibleMlService(timeoutMs: number, isCurrentProcess: () => boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isCurrentProcess()) return false;
    if ((await probeMlServiceCompatibility()).compatible && isCurrentProcess()) {
      mlServiceError = null;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** An operator's Stop Monitoring: stop every camera and do not resume them later. */
export async function stopCameraProcessingFromTray() {
  const enterpriseId = currentEnterpriseId();
  if (enterpriseId) forgetAllCounting(enterpriseId);
  await stopAllCameraProcessing();
}

/** Stop every camera but keep them remembered, e.g. while TANAW quits. */
async function stopAllCameraProcessing() {
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
    void countingPowerGuard.refresh();
  }
}

export async function requestCameraWithCredentials(scopeInput: unknown, cameraIdInput: unknown, operationInput: unknown, payloadInput: unknown) {
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const operation = operationInput === "test" || operationInput === "start" ? operationInput : null;
  if (!operation || !isObjectRecord(payloadInput)) {
    throw new Error("Unsupported secure camera request.");
  }
  const stored = getCameraCredential(scopeInput, cameraIdInput);
  // Test replacements in memory; starting a camera always uses saved credentials.
  const credentials = resolveCameraRequestCredential(operation, payloadInput, stored ?? undefined);
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
    // A connection test may try several stream addresses for the camera brand.
    signal: AbortSignal.timeout(operation === "start" ? 30_000 : 45_000),
  });
  if (!response.ok) {
    throw new Error(`Camera ${operation} request failed (${response.status}).`);
  }
  if (operation === "start") {
    const enterpriseId = currentEnterpriseId();
    if (enterpriseId) rememberCountingStart(enterpriseId, String(scopeInput), cameraId, payload);
    void countingPowerGuard.refresh();
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
  return lifecycleOperations.run(restartMlServiceUnlocked);
}

async function restartMlServiceUnlocked() {
  if (crashRestartTimer) clearTimeout(crashRestartTimer);
  crashRestartTimer = null;
  if (mlServiceConnectedExternally && !mlServiceProcess) {
    await stopExternalMlService(3000);
  } else {
    await stopMlService(3000);
  }

  await startMlServiceUnlocked();
  // Without this the new process knows no establishment: counting and reports stay closed.
  await rebindEnterpriseContext();
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

function isLocalMlServiceProcess(pid: number) {
  return isWorkspaceProcess(pid, getMlServiceDir(), getProcessInfo);
}

async function getProcessInfo(pid: number) {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildWindowsProcessInfoScript(pid)], { timeout: 3000, windowsHide: true });
      return parseProcessInfo(stdout, process.platform);
    }

    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "ppid=,command="], { timeout: 3000 });
    return parseProcessInfo(stdout, process.platform);
  } catch {
    return null;
  }
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

export function shutdownMlService() {
  return lifecycleOperations.run(shutdownMlServiceUnlocked);
}

async function shutdownMlServiceUnlocked() {
  shuttingDown = true;
  if (crashRestartTimer) clearTimeout(crashRestartTimer);
  crashRestartTimer = null;
  countingPowerGuard.dispose();
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = null;
  reportLiveEvents.dispose();
  if (isMlServiceRunning()) {
    // Quitting is not an operator's Stop: the cameras resume when TANAW starts again.
    await stopAllCameraProcessing();
  }
  if (shouldTerminateExternalService(mlServiceConnectedExternally, Boolean(mlServiceProcess))) {
    await stopExternalMlService(3000);
  } else {
    await stopMlService(3000);
  }
}
