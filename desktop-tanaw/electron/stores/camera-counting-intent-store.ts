import { app } from "electron";
import path from "node:path";
import { readSecureJson, writeSecureJson } from "./secure-json-store";

const STORE_FILE = "camera-counting-intents.json";

/** A camera the operator started and has not stopped, with the request that started it. */
export type CameraCountingIntent = {
  cameraId: string;
  /** The camera-credential scope the start used; credentials are looked up again on resume. */
  scope: string;
  /** The start request without its username and password. */
  payload: Record<string, unknown>;
};

type IntentRecord = { scope: string; payload: Record<string, unknown> };
type IntentStore = Record<string, Record<string, IntentRecord>>;

let cache: IntentStore | null = null;

/**
 * Remembers which cameras should be counting, per enterprise, across crashes and relaunches.
 *
 * Counting is meant to run all day. When the ML service restarts, the computer reboots, or a
 * camera was offline at the moment it was started, TANAW starts these cameras again instead of
 * waiting for someone to notice. Only an operator's Stop removes a camera from this list.
 */
export function rememberCountingStart(enterpriseId: string, scope: string, cameraId: string, payload: Record<string, unknown>) {
  const store = load();
  const stored = { ...payload };
  delete stored.username;
  delete stored.password;
  store[enterpriseId] = { ...store[enterpriseId], [cameraId]: { scope, payload: stored } };
  save(store);
}

export function forgetCountingCamera(enterpriseId: string, cameraId: string) {
  const store = load();
  if (!store[enterpriseId]?.[cameraId]) return;
  delete store[enterpriseId][cameraId];
  if (Object.keys(store[enterpriseId]).length === 0) delete store[enterpriseId];
  save(store);
}

export function forgetAllCounting(enterpriseId: string) {
  const store = load();
  if (!store[enterpriseId]) return;
  delete store[enterpriseId];
  save(store);
}

/** Drop cameras that no longer exist in the enterprise's camera list. */
export function keepCountingCameras(enterpriseId: string, cameraIds: ReadonlySet<string>) {
  const store = load();
  const cameras = store[enterpriseId];
  if (!cameras) return;
  const removed = Object.keys(cameras).filter((cameraId) => !cameraIds.has(cameraId));
  if (!removed.length) return;
  for (const cameraId of removed) delete cameras[cameraId];
  if (Object.keys(cameras).length === 0) delete store[enterpriseId];
  save(store);
}

/** A new performance profile applies to every remembered camera, as it does to running ones. */
export function updateCountingPerformance(enterpriseId: string, settings: Record<string, unknown>) {
  const store = load();
  const cameras = store[enterpriseId];
  if (!cameras) return;
  for (const record of Object.values(cameras)) {
    for (const key of ["processing_profile", "reid_mode"]) {
      if (typeof settings[key] === "string") record.payload[key] = settings[key];
    }
  }
  save(store);
}

export function listCountingIntents(enterpriseId: string): CameraCountingIntent[] {
  return Object.entries(load()[enterpriseId] ?? {}).map(([cameraId, record]) => ({ cameraId, scope: record.scope, payload: { ...record.payload } }));
}

/** For tests: forget the in-memory copy so the next call reads the file again. */
export function resetCountingIntentCache() {
  cache = null;
}

function load(): IntentStore {
  if (cache) return cache;
  try {
    cache = normalize(readSecureJson(storePath()));
  } catch (error) {
    // Without protected storage the list lives for this run only; counting still resumes after
    // a service restart, just not after the app itself restarts.
    console.warn("[tanaw] Camera counting state could not be read; resuming from memory only.", error);
    cache = {};
  }
  return cache;
}

function save(store: IntentStore) {
  cache = store;
  try {
    writeSecureJson(storePath(), store);
  } catch (error) {
    console.warn("[tanaw] Camera counting state could not be saved.", error);
  }
}

function storePath() {
  return path.join(app.getPath("userData"), STORE_FILE);
}

function normalize(value: unknown): IntentStore {
  const store: IntentStore = {};
  if (!isRecord(value)) return store;
  for (const [enterpriseId, cameras] of Object.entries(value)) {
    if (!isRecord(cameras)) continue;
    for (const [cameraId, record] of Object.entries(cameras)) {
      if (!/^\d+$/.test(cameraId) || !isRecord(record) || typeof record.scope !== "string" || !isRecord(record.payload)) continue;
      store[enterpriseId] = { ...store[enterpriseId], [cameraId]: { scope: record.scope, payload: record.payload } };
    }
  }
  return store;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
