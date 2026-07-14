import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, safeStorage, Tray, type IpcMainInvokeEvent } from "electron";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveMlOperationRequest, type MlOperation, type ResolvedMlRequest } from "./ml-ipc-contract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
let mlLaunchSession: MlLaunchSession | null = null;
let isQuitting = false;
let rendererSecurityHeadersRegistered = false;

const LOCAL_CONTRACT_VERSION = 2;
const LOCAL_RELEASE_ID = "target-cutover-release";
const LOCAL_SERVICE_NAME = "tanaw-ml-service";
const CONTROLLED_ML_SERVICE_URL = "tanaw-ml://local";
const CENTRAL_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const ML_READINESS_TIMEOUT_MS = 12_000;
const ML_HEALTH_TIMEOUT_MS = 10_000;
const ML_MAX_CONTROL_RECORD_BYTES = 4096;
const ML_MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const ML_SESSION_PROTOCOL_PREFIX = "tanaw-session.";
const ML_LAUNCH_PROTOCOL_PREFIX = "tanaw-launch.";
const CAMERA_CREDENTIAL_STORE_FILE = "camera-credentials.json";
const TRAY_ICON_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNgi3f7TwlmGDVg1IBRA4aLAQAdsKoQzBu6fQAAAABJRU5ErkJggg==";
const SPLASH_MIN_DISPLAY_MS = 1400;

type MlReadinessRecord = {
  launchId: string;
  localContractVersion: number;
  pid: number;
  port: number;
  releaseId: string;
  serviceName: string;
  startupNonce: string;
};

type MlLaunchSession = {
  baseUrl: string | null;
  cameraReconnectTimer: ReturnType<typeof setTimeout> | null;
  cameraSocket: WebSocket | null;
  capability: string;
  child: ChildProcess;
  launchId: string;
  ready: boolean;
  readiness: MlReadinessRecord | null;
};

type MlScopedSession = {
  expires_in_seconds: number;
  scope: "camera-events" | "stream";
  token: string;
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "tanaw-ml",
    privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
  },
]);

type CameraCredentialRecord = {
  cameraType?: CameraType;
  password?: string;
  streamUrl?: string;
  username?: string;
};

type CameraCredentialRecords = Record<string, CameraCredentialRecord>;
type CameraCredentialStore = Record<string, CameraCredentialRecords>;
type CameraType = "IP_WEBCAM" | "RTSP_CCTV" | "USB_WEBCAM" | "ONVIF_CCTV";

type ActiveCameraCredentialBinding = {
  cameraId: string;
  cameraType: CameraType;
  streamUrl: string;
};

type CameraCredentialStoreFile = {
  encoding: "safeStorage";
  payload: string;
  version: 3;
};

class CameraCredentialSecurityError extends Error {}

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

function getMlServiceCommand(serviceDir: string) {
  const bootstrapArgs = ["main.py", "--stdio-bootstrap", "--control-fd", "3"];
  const venvPython = process.platform === "win32" ? path.join(serviceDir, ".venv", "Scripts", "python.exe") : path.join(serviceDir, ".venv", "bin", "python");

  if (existsSync(venvPython)) {
    return { command: venvPython, args: bootstrapArgs };
  }

  return { command: "uv", args: ["run", "python", ...bootstrapArgs] };
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

  const { command, args } = getMlServiceCommand(serviceDir);
  const capability = randomBytes(32).toString("base64url");
  const launchId = randomUUID();
  mlServiceError = null;

  const child = spawn(command, args, {
    cwd: serviceDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      TANAW_APP_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const launch: MlLaunchSession = {
    baseUrl: null,
    cameraReconnectTimer: null,
    cameraSocket: null,
    capability,
    child,
    launchId,
    ready: false,
    readiness: null,
  };
  mlServiceProcess = child;
  mlLaunchSession = launch;
  updateTrayMenu();
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout?.on("data", (chunk) => {
    stdoutBuffer = consumeMlLogChunk(stdoutBuffer, chunk, launch, "info");
  });

  child.stderr?.on("data", (chunk) => {
    stderrBuffer = consumeMlLogChunk(stderrBuffer, chunk, launch, "error");
  });

  child.on("error", (error) => {
    if (mlServiceProcess !== child) {
      return;
    }

    mlServiceError = error.message;
    flushMlLogBuffer(stdoutBuffer, launch, "info");
    flushMlLogBuffer(stderrBuffer, launch, "error");
    stdoutBuffer = "";
    stderrBuffer = "";
    mlServiceProcess = null;
    disposeMlLaunch(launch);
    if (mlLaunchSession === launch) mlLaunchSession = null;
    updateTrayMenu();
  });

  child.on("exit", (code, signal) => {
    if (mlServiceProcess !== child) {
      return;
    }

    if (code && code !== 0) {
      mlServiceError = `ML service exited with code ${code}${signal ? ` (${signal})` : ""}.`;
    }
    flushMlLogBuffer(stdoutBuffer, launch, "info");
    flushMlLogBuffer(stderrBuffer, launch, "error");
    stdoutBuffer = "";
    stderrBuffer = "";
    mlServiceProcess = null;
    disposeMlLaunch(launch);
    if (mlLaunchSession === launch) mlLaunchSession = null;
    updateTrayMenu();
  });

  try {
    child.stdin?.end(
      JSON.stringify({
        capability,
        contractVersion: LOCAL_CONTRACT_VERSION,
        launchId,
      }),
    );
    const readiness = await readMlReadinessRecord(child, launchId);
    assertReadinessIdentity(readiness, child, launchId);
    launch.readiness = readiness;
    launch.baseUrl = `http://127.0.0.1:${readiness.port}`;
    await verifyMlHealthChallenge(launch);
    if (mlLaunchSession !== launch || mlServiceProcess !== child) {
      throw new Error("The ML service launch was superseded before verification.");
    }
    launch.ready = true;
    mlServiceError = null;
    connectMlCameraEvents(launch);
  } catch (error) {
    mlServiceError = redactMlLog(error instanceof Error ? error.message : "ML service identity verification failed.", launch);
    if (mlLaunchSession === launch) mlLaunchSession = null;
    if (mlServiceProcess === child) mlServiceProcess = null;
    disposeMlLaunch(launch);
    child.kill();
  } finally {
    updateTrayMenu();
  }
}

async function stopMlService(waitMs = 0) {
  if (!mlServiceProcess) {
    if (mlLaunchSession) disposeMlLaunch(mlLaunchSession);
    mlLaunchSession = null;
    updateTrayMenu();
    return;
  }

  const serviceProcess = mlServiceProcess;
  const launch = mlLaunchSession;
  mlServiceProcess = null;
  mlLaunchSession = null;
  if (launch) disposeMlLaunch(launch);
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
  return Boolean(mlServiceProcess && mlLaunchSession?.ready);
}

function getMlServiceStatusPayload() {
  return {
    baseUrl: CONTROLLED_ML_SERVICE_URL,
    error: mlServiceError,
    pid: mlLaunchSession?.ready ? (mlServiceProcess?.pid ?? null) : null,
    running: isMlServiceRunning(),
  };
}

async function stopCameraProcessingFromTray() {
  try {
    await requestMlOperation("camera.stop", undefined);
    mlServiceError = null;
  } catch (error) {
    mlServiceError = error instanceof Error ? error.message : "Unable to stop camera processing.";
  } finally {
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
    if (!isObjectRecord(raw)) {
      throw new Error("Invalid camera credential store.");
    }

    if (raw.version === 3 && raw.encoding === "safeStorage" && typeof raw.payload === "string") {
      assertSecureCameraCredentialStorage();
      const decrypted = safeStorage.decryptString(Buffer.from(raw.payload, "base64"));
      return normalizeCredentialStore(JSON.parse(decrypted) as unknown, true);
    }
    throw new Error("The camera credential store has an unsupported format.");
  } catch (error) {
    if (error instanceof CameraCredentialSecurityError) throw error;
    if (existsSync(storePath)) unlinkSync(storePath);
    throw new CameraCredentialSecurityError("The secure camera credential store could not be read.");
  }
}

function saveCameraCredentialStore(store: CameraCredentialStore) {
  const storePath = getCameraCredentialStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });

  assertSecureCameraCredentialStorage();
  const payload: CameraCredentialStoreFile = {
    encoding: "safeStorage",
    payload: safeStorage.encryptString(JSON.stringify(store)).toString("base64"),
    version: 3,
  };

  const temporaryPath = `${storePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, storePath);
    chmodSync(storePath, 0o600);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function assertSecureCameraCredentialStorage() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
    throw new CameraCredentialSecurityError("Secure operating-system credential storage is unavailable.");
  }
}

function loadCameraCredentials(scopeInput: unknown): CameraCredentialRecords {
  const scope = normalizeCredentialScope(scopeInput);
  const store = loadCameraCredentialStore();
  return store[scope] ?? {};
}

function saveCameraCredentials(scopeInput: unknown, recordsInput: unknown, activeCameraBindingsInput: unknown): void {
  const scope = normalizeCredentialScope(scopeInput);
  const records = normalizeCredentialMutations(recordsInput);
  const store = loadCameraCredentialStore();
  const activeCameraBindings = normalizeActiveCameraBindings(activeCameraBindingsInput);
  const scopedRecords = store[scope] ?? {};

  for (const cameraId of Object.keys(scopedRecords)) {
    const activeBinding = activeCameraBindings.get(cameraId);
    if (!activeBinding) {
      delete scopedRecords[cameraId];
      continue;
    }
    const existing = scopedRecords[cameraId];
    if (!hasCredentialBinding(existing)) {
      scopedRecords[cameraId] = { ...existing, cameraType: activeBinding.cameraType, streamUrl: activeBinding.streamUrl };
    } else if (!credentialBindingMatches(existing, activeBinding)) {
      delete scopedRecords[cameraId];
    }
  }
  for (const [cameraId, record] of Object.entries(records)) {
    if (!record.username && !record.password) continue;
    const activeBinding = activeCameraBindings.get(cameraId);
    if (!activeBinding) throw new Error("Camera credentials require an active camera binding.");
    const existing = scopedRecords[cameraId] ?? {};
    const mayMerge = credentialBindingMatches(existing, activeBinding);
    scopedRecords[cameraId] = {
      cameraType: activeBinding.cameraType,
      password: record.password ?? (mayMerge ? existing.password : undefined),
      streamUrl: activeBinding.streamUrl,
      username: record.username ?? (mayMerge ? existing.username : undefined),
    };
  }
  if (Object.keys(scopedRecords).length > 0) store[scope] = scopedRecords;
  else delete store[scope];

  if (Object.keys(store).length === 0) {
    const storePath = getCameraCredentialStorePath();
    if (existsSync(storePath)) unlinkSync(storePath);
    return;
  }
  saveCameraCredentialStore(store);
}

function normalizeActiveCameraBindings(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("Active camera bindings are required.");
  const bindings = new Map<string, ActiveCameraCredentialBinding>();
  for (const item of value) {
    if (!isObjectRecord(item) || !hasExactKeys(item, ["cameraId", "cameraType", "streamUrl"])) {
      throw new Error("Invalid active camera binding.");
    }
    const cameraId = normalizeCameraId(item.cameraId);
    if (bindings.has(cameraId)) throw new Error("Camera bindings must have unique identifiers.");
    bindings.set(cameraId, {
      cameraId,
      cameraType: normalizeCameraType(item.cameraType),
      streamUrl: normalizeCameraStreamUrl(item.streamUrl),
    });
  }
  return bindings;
}

function normalizeCredentialScope(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 240) {
    throw new Error("Camera credential scope is required.");
  }
  return value.trim();
}

function normalizeCredentialStore(value: unknown, requireBinding = false): CameraCredentialStore {
  if (!isObjectRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([scope, records]) => [normalizeCredentialScope(scope), normalizeCredentialRecords(records, requireBinding)] as const)
      .filter(([, records]) => Object.keys(records).length > 0),
  );
}

function normalizeCredentialRecords(value: unknown, requireBinding = false): CameraCredentialRecords {
  if (!isObjectRecord(value)) {
    return {};
  }

  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !isObjectRecord(record)) {
      continue;
    }

    const username = normalizeCredentialValue(record.username);
    const password = normalizeCredentialValue(record.password);
    if (username || password) {
      const binding = normalizeStoredCredentialBinding(record);
      if (!requireBinding || binding) records[cameraId] = { ...binding, password, username };
    }
  }
  return records;
}

function normalizeCredentialMutations(value: unknown): CameraCredentialRecords {
  if (!isObjectRecord(value) || Object.keys(value).length > 1000) throw new Error("Invalid camera credential records.");
  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !isObjectRecord(record)) throw new Error("Invalid camera credential record.");
    records[cameraId] = {
      username: normalizeCredentialValue(record.username),
      password: normalizeCredentialValue(record.password),
    };
  }
  return records;
}

function normalizeCredentialValue(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}

function normalizeStoredCredentialBinding(value: Record<string, unknown>) {
  if (value.cameraType === undefined && value.streamUrl === undefined) return undefined;
  try {
    return {
      cameraType: normalizeCameraType(value.cameraType),
      streamUrl: normalizeCameraStreamUrl(value.streamUrl),
    };
  } catch {
    return undefined;
  }
}

function hasCredentialBinding(record: CameraCredentialRecord): record is CameraCredentialRecord & { cameraType: CameraType; streamUrl: string } {
  return Boolean(record.cameraType && record.streamUrl);
}

function credentialBindingMatches(record: CameraCredentialRecord, binding: ActiveCameraCredentialBinding) {
  return hasCredentialBinding(record) && record.cameraType === binding.cameraType && record.streamUrl === binding.streamUrl;
}

function normalizeCameraId(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new Error("Invalid active camera identifier.");
  }
  return String(value);
}

function normalizeCameraType(value: unknown): CameraType {
  if (value === "IP_WEBCAM" || value === "RTSP_CCTV" || value === "USB_WEBCAM" || value === "ONVIF_CCTV") return value;
  throw new Error("Invalid camera type.");
}

function normalizeCameraStreamUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4096) throw new Error("Invalid camera stream URL.");
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return normalized;
  let streamUrl: URL;
  try {
    streamUrl = new URL(normalized);
  } catch {
    throw new Error("Invalid camera stream URL.");
  }
  if (!["http:", "https:", "rtsp:"].includes(streamUrl.protocol) || streamUrl.username || streamUrl.password) {
    throw new Error("Invalid camera stream URL.");
  }
  return streamUrl.toString();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function restartMlService() {
  await stopMlService(3000);
  await startMlService();
}

function readMlReadinessRecord(child: ChildProcess, expectedLaunchId: string) {
  return new Promise<MlReadinessRecord>((resolve, reject) => {
    const control = child.stdio[3] as Readable | null;
    if (!control) {
      reject(new Error("The ML service readiness pipe is unavailable."));
      return;
    }

    let buffer = "";
    const timeout = setTimeout(() => finish(new Error("The ML service readiness record timed out.")), ML_READINESS_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      control.off("data", onData);
      control.off("end", onEnd);
      control.off("error", onControlError);
      child.off("exit", onExit);
      child.off("error", onChildError);
    };

    const finish = (error: Error | null, readiness?: MlReadinessRecord) => {
      cleanup();
      if (error) reject(error);
      else if (readiness) resolve(readiness);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > ML_MAX_CONTROL_RECORD_BYTES) {
        finish(new Error("The ML service readiness record is too large."));
      }
    };

    const onEnd = () => {
      const records = buffer
        .split("\n")
        .map((record) => record.trim())
        .filter(Boolean);
      if (records.length !== 1) {
        finish(new Error("The ML service sent repeated readiness records."));
        return;
      }
      try {
        finish(null, parseReadinessRecord(records[0], expectedLaunchId));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid ML service readiness record."));
      }
    };

    const onControlError = () => finish(new Error("The ML service readiness pipe failed."));
    const onExit = () => finish(new Error("The ML service exited before readiness verification."));
    const onChildError = () => finish(new Error("The ML service failed before readiness verification."));

    control.on("data", onData);
    control.once("end", onEnd);
    control.once("error", onControlError);
    child.once("exit", onExit);
    child.once("error", onChildError);
  });
}

function parseReadinessRecord(raw: string, expectedLaunchId: string): MlReadinessRecord {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObjectRecord(parsed)) throw new Error("Invalid ML service readiness record.");
  const expectedKeys = ["launchId", "localContractVersion", "pid", "port", "releaseId", "serviceName", "startupNonce"];
  if (Object.keys(parsed).sort().join("|") !== expectedKeys.sort().join("|")) {
    throw new Error("Invalid ML service readiness record.");
  }
  if (
    parsed.launchId !== expectedLaunchId ||
    parsed.localContractVersion !== LOCAL_CONTRACT_VERSION ||
    parsed.releaseId !== LOCAL_RELEASE_ID ||
    parsed.serviceName !== LOCAL_SERVICE_NAME ||
    typeof parsed.startupNonce !== "string" ||
    !/^[A-Za-z0-9_-]{24,128}$/.test(parsed.startupNonce) ||
    !Number.isInteger(parsed.pid) ||
    !Number.isInteger(parsed.port) ||
    Number(parsed.port) < 1 ||
    Number(parsed.port) > 65535
  ) {
    throw new Error("Invalid ML service readiness identity.");
  }
  return parsed as MlReadinessRecord;
}

function assertReadinessIdentity(readiness: MlReadinessRecord, child: ChildProcess, expectedLaunchId: string) {
  if (!child.pid || readiness.pid !== child.pid || readiness.launchId !== expectedLaunchId) {
    throw new Error("The ML service readiness identity does not match the spawned child.");
  }
}

async function verifyMlHealthChallenge(launch: MlLaunchSession) {
  const readiness = launch.readiness;
  if (!readiness || !launch.baseUrl) throw new Error("The ML service is missing verified readiness state.");
  const deadline = Date.now() + ML_HEALTH_TIMEOUT_MS;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const challenge = randomBytes(32).toString("base64url");
    try {
      const response = await authenticatedMlFetch(launch, "/health", { headers: { "X-TANAW-Health-Challenge": challenge }, method: "GET" }, 1000);
      if (!response.ok) throw new Error("The ML service rejected its launch health challenge.");
      const identity = (await response.json()) as unknown;
      const expectedProof = createHmac("sha256", launch.capability).update(`health:${launch.launchId}:${readiness.startupNonce}:${challenge}`).digest("base64url");
      if (
        !isObjectRecord(identity) ||
        identity.serviceName !== LOCAL_SERVICE_NAME ||
        identity.localContractVersion !== LOCAL_CONTRACT_VERSION ||
        identity.releaseId !== LOCAL_RELEASE_ID ||
        identity.launchId !== launch.launchId ||
        identity.pid !== launch.child.pid ||
        identity.status !== "ready" ||
        typeof identity.challengeResponse !== "string" ||
        !safeEqualText(identity.challengeResponse, expectedProof)
      ) {
        throw new Error("The ML service failed its launch identity challenge.");
      }
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("ML service health challenge failed.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("The ML service health challenge timed out.");
}

async function requestMlOperation(operation: MlOperation, payload: unknown) {
  const request = resolveMlOperationRequest(operation, payload);
  return requestResolvedMlOperation(request);
}

async function requestResolvedMlOperation(request: ResolvedMlRequest) {
  const launch = requireReadyMlLaunch();
  const body = hydrateMlRequestCredentials(request);
  const response = await authenticatedMlFetch(
    launch,
    request.path,
    {
      body,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      method: request.method,
    },
    getMlRequestTimeout(request.path),
  );
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > ML_MAX_JSON_RESPONSE_BYTES) {
    throw new Error("The ML service response exceeded the allowed size.");
  }
  if (!response.ok) {
    throw new Error(getMlResponseError(response.status, text));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The ML service returned an invalid response.");
  }
}

function hydrateMlRequestCredentials(request: ResolvedMlRequest) {
  if (!request.body || !request.credentialRef) return request.body;
  const payload = JSON.parse(request.body) as Record<string, unknown>;
  const stored = loadCameraCredentials(request.credentialRef.scope)[request.credentialRef.cameraId];
  if (stored) {
    const requestBinding: ActiveCameraCredentialBinding = {
      cameraId: request.credentialRef.cameraId,
      cameraType: normalizeCameraType(payload.camera_type),
      streamUrl: normalizeCameraStreamUrl(payload.stream_url),
    };
    if (!credentialBindingMatches(stored, requestBinding)) {
      throw new CameraCredentialSecurityError("Stored camera credentials are unavailable for this camera connection.");
    }
  }
  payload.username = stored?.username ?? null;
  payload.password = stored?.password ?? null;
  return JSON.stringify(payload);
}

async function authenticatedMlFetch(launch: MlLaunchSession, requestPath: string, init: RequestInit, timeoutMs: number) {
  if (!launch.baseUrl || mlLaunchSession !== launch) throw new Error("The verified ML service is unavailable.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `TANAW-Capability ${launch.capability}`);
  headers.set("X-TANAW-Launch-ID", launch.launchId);
  try {
    return await fetch(`${launch.baseUrl}${requestPath}`, { ...init, cache: "no-store", headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function requireReadyMlLaunch() {
  const launch = mlLaunchSession;
  if (!launch?.ready || !launch.baseUrl || launch.child !== mlServiceProcess) {
    throw new Error("The verified ML service is unavailable.");
  }
  return launch;
}

function getMlRequestTimeout(requestPath: string) {
  if (requestPath === "/camera/start") return 30_000;
  if (requestPath === "/mock/prepare" || requestPath === "/mock/start") return 15_000;
  if (requestPath === "/context/enterprise") return 10_000;
  return 8_000;
}

function getMlResponseError(status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isObjectRecord(parsed) && typeof parsed.detail === "string") {
      return redactMlLog(parsed.detail, mlLaunchSession);
    }
  } catch {
    // The status-only fallback deliberately avoids reflecting an untrusted body.
  }
  return `ML service request failed with status ${status}.`;
}

async function mintMlScopedSession(launch: MlLaunchSession, scope: MlScopedSession["scope"]) {
  const response = await authenticatedMlFetch(
    launch,
    "/auth/session",
    {
      body: JSON.stringify({ scope, ttl_seconds: 45 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    2500,
  );
  if (!response.ok) throw new Error("The ML service refused a scoped local session.");
  const session = (await response.json()) as unknown;
  if (!isObjectRecord(session) || session.scope !== scope || typeof session.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(session.token) || typeof session.expires_in_seconds !== "number") {
    throw new Error("The ML service returned an invalid scoped session.");
  }
  return session as MlScopedSession;
}

function connectMlCameraEvents(launch: MlLaunchSession) {
  if (!launch.ready || !launch.baseUrl || mlLaunchSession !== launch) return;
  void mintMlScopedSession(launch, "camera-events")
    .then((session) => {
      if (!launch.ready || !launch.baseUrl || mlLaunchSession !== launch) return;
      const websocketUrl = new URL("/camera/ws", launch.baseUrl);
      websocketUrl.protocol = "ws:";
      const socket = new WebSocket(websocketUrl, [`${ML_SESSION_PROTOCOL_PREFIX}${session.token}`, `${ML_LAUNCH_PROTOCOL_PREFIX}${launch.launchId}`]);
      launch.cameraSocket = socket;
      socket.addEventListener("open", () => sendCameraBridgeEvent({ type: "service.connection", data: { connected: true } }));
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || Buffer.byteLength(event.data, "utf8") > ML_MAX_JSON_RESPONSE_BYTES) return;
        try {
          const envelope = sanitizeCameraBridgeEnvelope(JSON.parse(event.data) as unknown, launch);
          if (envelope) sendCameraBridgeEvent(envelope);
        } catch {
          // Invalid child messages are discarded rather than forwarded to the renderer.
        }
      });
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("close", () => {
        if (launch.cameraSocket === socket) launch.cameraSocket = null;
        sendCameraBridgeEvent({ type: "service.connection", data: { connected: false } });
        scheduleMlCameraReconnect(launch);
      });
    })
    .catch(() => scheduleMlCameraReconnect(launch));
}

function scheduleMlCameraReconnect(launch: MlLaunchSession) {
  if (!launch.ready || mlLaunchSession !== launch || launch.cameraReconnectTimer) return;
  launch.cameraReconnectTimer = setTimeout(() => {
    launch.cameraReconnectTimer = null;
    connectMlCameraEvents(launch);
  }, 1000);
}

function sendCameraBridgeEvent(envelope: unknown) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("ml-service:camera-event", envelope);
}

function sanitizeCameraBridgeEnvelope(value: unknown, launch: MlLaunchSession) {
  if (!isObjectRecord(value)) return null;
  if (value.type === "heartbeat") return Object.keys(value).length === 1 ? { type: "heartbeat" } : null;
  if (value.type !== "camera.state" || !hasExactKeys(value, ["data", "type"]) || !isObjectRecord(value.data) || !hasExactKeys(value.data, ["counts", "detections", "health", "session"])) return null;
  const { counts, detections, health, session } = value.data;
  if (!isObjectRecord(counts) || !isObjectRecord(detections) || !isObjectRecord(health) || !isObjectRecord(session)) return null;
  if (
    typeof counts.running !== "boolean" ||
    typeof counts.entry !== "number" ||
    typeof counts.exit !== "number" ||
    typeof counts.occupancy !== "number" ||
    typeof detections.running !== "boolean" ||
    !Array.isArray(detections.tracks) ||
    detections.tracks.length > 2000 ||
    typeof session.running !== "boolean" ||
    !isObjectRecord(session.counts) ||
    "camera_config" in session ||
    !isSafeBridgeValue(value, launch, 0)
  ) {
    return null;
  }
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isSafeBridgeValue(value: unknown, launch: MlLaunchSession, depth: number): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") {
    return value.length <= 16_384 && !value.includes(launch.capability) && !/TANAW-(?:Capability|Session)\s+|tanaw-session\.|\b(?:rtsp|https?):\/\/[^\s]*@/i.test(value);
  }
  if (Array.isArray(value)) return value.length <= 5000 && value.every((item) => isSafeBridgeValue(item, launch, depth + 1));
  if (!isObjectRecord(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(([key, item]) => !/^(?:authorization|capability|password|token|username|stream_url)$/i.test(key) && isSafeBridgeValue(item, launch, depth + 1));
}

function disposeMlLaunch(launch: MlLaunchSession) {
  launch.ready = false;
  if (launch.cameraReconnectTimer) clearTimeout(launch.cameraReconnectTimer);
  launch.cameraReconnectTimer = null;
  const socket = launch.cameraSocket;
  launch.cameraSocket = null;
  if (socket) socket.close();
  sendCameraBridgeEvent({ type: "service.connection", data: { connected: false } });
  launch.capability = "";
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function redactMlLog(value: string, launch: MlLaunchSession | null) {
  let redacted = value;
  if (launch?.capability) redacted = redacted.split(launch.capability).join("[REDACTED_CAPABILITY]");
  redacted = redacted.replace(/TANAW-(?:Capability|Session)\s+[A-Za-z0-9_-]+/gi, "[REDACTED_AUTHORIZATION]");
  redacted = redacted.replace(/tanaw-session\.[A-Za-z0-9_-]+/gi, "tanaw-session.[REDACTED]");
  redacted = redacted.replace(/\b(?:rtsp|https?):\/\/[^\s"']+/gi, "[REDACTED_URL]");
  redacted = redacted.replace(/([?&](?:token|password|secret|key)=)[^&\s]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(["']?(?:password|username|authorization|capability|token)["']?\s*[:=]\s*)[^,}\s]+/gi, "$1[REDACTED]");
  return redacted;
}

function consumeMlLogChunk(buffer: string, chunk: unknown, launch: MlLaunchSession, level: "error" | "info") {
  if (!launch.capability) return "";
  const combined = `${buffer}${String(chunk)}`;
  if (Buffer.byteLength(combined, "utf8") > 1_048_576 && !combined.includes("\n")) {
    writeMlLog("[oversized child output omitted]", level);
    return "";
  }
  const records = combined.split(/\r?\n/);
  const remainder = records.pop() ?? "";
  for (const record of records) flushMlLogBuffer(record, launch, level);
  return remainder;
}

function flushMlLogBuffer(buffer: string, launch: MlLaunchSession, level: "error" | "info") {
  if (Buffer.byteLength(buffer, "utf8") > 65_536) {
    writeMlLog("[oversized child output omitted]", level);
    return;
  }
  const message = redactMlLog(buffer.trim(), launch);
  if (message) writeMlLog(message, level);
}

function writeMlLog(message: string, level: "error" | "info") {
  if (level === "error") console.error(`[tanaw-ml] ${message}`);
  else console.info(`[tanaw-ml] ${message}`);
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
  ipcMain.handle("ml-service:get-status", (event) => {
    assertTrustedRenderer(event);
    return getMlServiceStatusPayload();
  });

  ipcMain.handle("ml-service:restart", async (event) => {
    assertTrustedRenderer(event);
    await restartMlService();
    return getMlServiceStatusPayload();
  });

  ipcMain.handle("ml-service:stop-camera", async (event) => {
    assertTrustedRenderer(event);
    await stopCameraProcessingFromTray();
    return getMlServiceStatusPayload();
  });

  ipcMain.handle("ml-service:request", (event, operation: unknown, payload: unknown) => {
    assertTrustedRenderer(event);
    const resolved = resolveMlOperationRequest(operation, payload);
    return requestResolvedMlOperation(resolved);
  });
}

function registerCameraCredentialIpc() {
  ipcMain.handle("camera-credentials:save", (event, scope: unknown, records: unknown, activeCameraBindings: unknown) => {
    assertTrustedRenderer(event);
    saveCameraCredentials(scope, records, activeCameraBindings);
  });
}

function assertTrustedRenderer(event: IpcMainInvokeEvent) {
  const senderFrame = event.senderFrame;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || senderFrame !== win.webContents.mainFrame || !isTrustedRendererUrl(senderFrame.url)) {
    throw new Error("Unauthorized renderer IPC source.");
  }
}

function isTrustedRendererUrl(value: string) {
  try {
    const candidate = new URL(value);
    if (VITE_DEV_SERVER_URL) return candidate.origin === new URL(VITE_DEV_SERVER_URL).origin;
    if (candidate.protocol !== "file:") return false;
    const candidatePath = path.resolve(fileURLToPath(candidate));
    const rendererRoot = `${path.resolve(RENDERER_DIST)}${path.sep}`;
    return candidatePath === path.join(RENDERER_DIST, "index.html") || candidatePath.startsWith(rendererRoot);
  } catch {
    return false;
  }
}

function registerRendererSecurityHeaders() {
  if (rendererSecurityHeadersRegistered || !win) return;
  rendererSecurityHeadersRegistered = true;
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" || !isTrustedRendererUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [buildRendererContentSecurityPolicy()],
      },
    });
  });
}

function buildRendererContentSecurityPolicy() {
  const apiOrigin = safeUrlOrigin(CENTRAL_API_BASE_URL, "http://localhost:8000");
  const websocketOrigin = apiOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const developmentOrigin = VITE_DEV_SERVER_URL ? safeUrlOrigin(VITE_DEV_SERVER_URL, "http://127.0.0.1:5174") : null;
  const connectSources = ["'self'", apiOrigin, websocketOrigin, developmentOrigin, developmentOrigin?.replace(/^http:/, "ws:").replace(/^https:/, "wss:")].filter((value): value is string =>
    Boolean(value),
  );
  const scriptSources = ["'self'", ...(VITE_DEV_SERVER_URL ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob: tanaw-ml: https://upload.wikimedia.org",
    "media-src 'self' blob: tanaw-ml:",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "worker-src 'self' blob:",
  ].join("; ");
}

function safeUrlOrigin(value: string, fallback: string) {
  try {
    return new URL(value).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

function registerMlStreamProtocol() {
  protocol.handle("tanaw-ml", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const queryKeys = [...requestUrl.searchParams.keys()];
      if (
        request.method !== "GET" ||
        requestUrl.hostname !== "stream" ||
        requestUrl.pathname !== "/" ||
        queryKeys.some((key) => key !== "overlay" && key !== "v") ||
        !/^(0|1)$/.test(requestUrl.searchParams.get("overlay") ?? "1") ||
        !/^\d{1,12}$/.test(requestUrl.searchParams.get("v") ?? "0")
      ) {
        return new Response("Not found", { status: 404 });
      }

      const launch = requireReadyMlLaunch();
      const overlay = requestUrl.searchParams.get("overlay") ?? "1";
      const response = await openAuthenticatedMlStream(launch, overlay);
      if (!response.ok || !response.body) {
        return new Response("ML stream unavailable", { status: 502 });
      }
      return new Response(createReconnectableMlStream(launch, overlay, response.body), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": response.headers.get("Content-Type") ?? "multipart/x-mixed-replace; boundary=frame",
        },
        status: 200,
      });
    } catch {
      return new Response("ML stream unavailable", { status: 503 });
    }
  });
}

async function openAuthenticatedMlStream(launch: MlLaunchSession, overlay: string) {
  if (!launch.baseUrl || !launch.ready || mlLaunchSession !== launch) throw new Error("The verified ML service is unavailable.");
  const scopedSession = await mintMlScopedSession(launch, "stream");
  return fetch(`${launch.baseUrl}/stream?overlay=${overlay}`, {
    cache: "no-store",
    headers: {
      Authorization: `TANAW-Session ${scopedSession.token}`,
      "X-TANAW-Launch-ID": launch.launchId,
    },
    method: "GET",
  });
}

function createReconnectableMlStream(launch: MlLaunchSession, overlay: string, initialBody: ReadableStream<Uint8Array>) {
  let cancelled = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let body: ReadableStream<Uint8Array> | null = initialBody;
      while (!cancelled && launch.ready && mlLaunchSession === launch) {
        try {
          if (!body) {
            const response = await openAuthenticatedMlStream(launch, overlay);
            if (!response.ok || !response.body) {
              await waitForMlStreamReconnect();
              continue;
            }
            body = response.body;
          }
          activeReader = body.getReader();
          while (!cancelled && launch.ready && mlLaunchSession === launch) {
            const chunk = await activeReader.read();
            if (chunk.done) break;
            controller.enqueue(chunk.value);
          }
          activeReader.releaseLock();
          activeReader = null;
          body = null;
        } catch {
          try {
            await activeReader?.cancel();
          } catch {
            // The child stream is already unavailable.
          }
          activeReader = null;
          body = null;
          if (!cancelled && launch.ready && mlLaunchSession === launch) await waitForMlStreamReconnect();
        }
      }
      if (!cancelled) controller.close();
    },
    async cancel() {
      cancelled = true;
      await activeReader?.cancel();
    },
  });
}

function waitForMlStreamReconnect() {
  return new Promise((resolve) => setTimeout(resolve, 250));
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
    minWidth: 1100,
    minHeight: 720,
    icon: getWindowIcon(),
    show: false,
    title: "TANAW Enterprise Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.mjs"),
      sandbox: true,
      webSecurity: true,
    },
  });
  registerRendererSecurityHeaders();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  win.maximize();

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
    registerMlStreamProtocol();
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
