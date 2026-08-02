import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const STORE_FILE = "auth-session.json";
type StoredAuthSession = { token: string; user: Record<string, unknown> };

export function loadAuthSession(): StoredAuthSession | null {
  if (!existsSync(storePath()) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || raw.encoding !== "safeStorage" || typeof raw.payload !== "string") return null;
    return normalizeSession(JSON.parse(safeStorage.decryptString(Buffer.from(raw.payload, "base64"))) as unknown);
  } catch {
    return null;
  }
}

export function saveAuthSession(sessionInput: unknown) {
  const session = normalizeSession(sessionInput);
  if (!session || !safeStorage.isEncryptionAvailable()) return false;
  mkdirSync(path.dirname(storePath()), { recursive: true });
  writeFileSync(storePath(), JSON.stringify({ encoding: "safeStorage", payload: safeStorage.encryptString(JSON.stringify(session)).toString("base64"), version: 1 }), {
    encoding: "utf8",
    mode: 0o600,
  });
  return true;
}

export function clearAuthSession() {
  if (existsSync(storePath())) unlinkSync(storePath());
}

function storePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

function normalizeSession(value: unknown): StoredAuthSession | null {
  if (!isRecord(value) || typeof value.token !== "string" || !value.token || !isRecord(value.user)) return null;
  return { token: value.token, user: value.user };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
