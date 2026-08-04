import { app } from "electron";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { cameraCredentialScopeForUser } from "../camera-credential-scope";
import { readSecureJson, writeSecureJson } from "./secure-json-store";

const STORE_FILE = "auth-session.json";
type StoredAuthSession = { token: string; user: Record<string, unknown> };
let currentAuthSession: StoredAuthSession | null = null;

export function loadAuthSession(): StoredAuthSession | null {
  if (currentAuthSession) return currentAuthSession;
  currentAuthSession = normalizeSession(readSecureJson(storePath()));
  return currentAuthSession;
}

export function saveAuthSession(sessionInput: unknown, persist = true) {
  const session = normalizeSession(sessionInput);
  if (!session) return false;
  currentAuthSession = session;
  if (persist) {
    writeSecureJson(storePath(), session);
  } else if (existsSync(storePath())) {
    unlinkSync(storePath());
  }
  return true;
}

export function clearAuthSession() {
  currentAuthSession = null;
  if (existsSync(storePath())) unlinkSync(storePath());
}

function storePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

function normalizeSession(value: unknown): StoredAuthSession | null {
  if (!isRecord(value) || typeof value.token !== "string" || !value.token || !isRecord(value.user)) return null;
  return { token: value.token, user: value.user };
}

export function cameraCredentialScopeForCurrentSession() {
  const session = currentAuthSession ?? loadAuthSession();
  return cameraCredentialScopeForUser(session?.user);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
