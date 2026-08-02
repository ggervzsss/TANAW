import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeCameraPassword, normalizeCameraUsername, resolveCameraCredential } from "../camera-credential-validation";

const STORE_FILE = "camera-credentials.json";

type CameraCredentialRecord = { password: string; username: string };
type CameraCredentialRecords = Record<string, CameraCredentialRecord>;
type CameraCredentialStore = Record<string, CameraCredentialRecords>;
export type CameraCredentialMetadata = { passwordConfigured: boolean; username?: string };

export function loadCameraCredentials(scopeInput: unknown): Record<string, CameraCredentialMetadata> {
  const scope = normalizeCredentialScope(scopeInput);
  return toCredentialMetadata(loadStore()[scope] ?? {});
}

export function getCameraCredential(scopeInput: unknown, cameraIdInput: unknown) {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  return loadStore()[scope]?.[cameraId] ?? null;
}

export function saveCameraCredential(scopeInput: unknown, cameraIdInput: unknown, credentialInput: unknown): CameraCredentialMetadata {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const store = loadStore();
  const credential = resolveCameraCredential(credentialInput, store[scope]?.[cameraId]);
  store[scope] = { ...store[scope], [cameraId]: credential };
  saveStore(store);
  return { passwordConfigured: true, username: credential.username };
}

export function removeCameraCredential(scopeInput: unknown, cameraIdInput: unknown) {
  const scope = normalizeCredentialScope(scopeInput);
  const cameraId = normalizeCameraCredentialId(cameraIdInput);
  const store = loadStore();
  if (!store[scope]?.[cameraId]) return;
  delete store[scope][cameraId];
  if (Object.keys(store[scope]).length === 0) delete store[scope];
  saveStore(store);
}

export function normalizeCameraCredentialId(value: unknown) {
  const cameraId = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(cameraId) || cameraId < 0) throw new Error("A valid camera ID is required.");
  return String(cameraId);
}

function storePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

function loadStore(): CameraCredentialStore {
  if (!existsSync(storePath())) return {};
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || raw.encoding !== "safeStorage" || typeof raw.payload !== "string" || !safeStorage.isEncryptionAvailable()) return {};
    return normalizeStore(JSON.parse(safeStorage.decryptString(Buffer.from(raw.payload, "base64"))) as unknown);
  } catch {
    return {};
  }
}

function saveStore(store: CameraCredentialStore) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure camera credential storage is unavailable.");
  mkdirSync(path.dirname(storePath()), { recursive: true });
  writeFileSync(storePath(), JSON.stringify({ encoding: "safeStorage", payload: safeStorage.encryptString(JSON.stringify(store)).toString("base64"), version: 1 }), { encoding: "utf8", mode: 0o600 });
}

function normalizeCredentialScope(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Camera credential scope is required.");
  return value.trim().slice(0, 240);
}

function normalizeStore(value: unknown): CameraCredentialStore {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([scope, records]) => [normalizeCredentialScope(scope), normalizeRecords(records)] as const)
      .filter(([, records]) => Object.keys(records).length > 0),
  );
}

function normalizeRecords(value: unknown): CameraCredentialRecords {
  if (!isRecord(value)) return {};
  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !isRecord(record)) continue;
    const username = normalizeCameraUsername(record.username);
    const password = normalizeCameraPassword(record.password);
    if (Boolean(username) !== Boolean(password)) throw new Error(`Camera ${cameraId} requires both username and password credentials.`);
    if (username && password) records[cameraId] = { password, username };
  }
  return records;
}

function toCredentialMetadata(records: CameraCredentialRecords): Record<string, CameraCredentialMetadata> {
  return Object.fromEntries(Object.entries(records).map(([cameraId, record]) => [cameraId, { passwordConfigured: Boolean(record.password), username: record.username }]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
