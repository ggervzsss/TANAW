const PAGE_STATE_PREFIX = "tanaw:page-state:v1";
const MAX_MEMORY_ENTRIES = 200;
const MAX_PAGE_STATE_LENGTH = 128 * 1024;
const SENSITIVE_PAGE_STATE_KEY = /(password|token|secret|credential|resetcode|activationcode)/i;
const memoryState = new Map<string, string>();

export type PageStateStorage = "memory" | "session";

export type PageStateScope = {
  portal: string;
  role: string;
  userId: string;
};

export function createPageStateKey(scope: PageStateScope, route: string, namespace: string) {
  return [PAGE_STATE_PREFIX, scope.portal, scope.role, scope.userId, route, namespace].map(encodeURIComponent).join(":");
}

export function readPageState<T>(key: string, version: number, isValid: (value: unknown) => value is T, storage: PageStateStorage = "session"): T | null {
  try {
    const raw = readRawState(key, storage);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown; version?: unknown };
    if (parsed.version === version && isValid(parsed.value)) return parsed.value;
    removePageState(key, storage);
    return null;
  } catch {
    removePageState(key, storage);
    return null;
  }
}

export function writePageState<T>(key: string, version: number, value: T, storage: PageStateStorage = "session") {
  if (!isSafePageStateValue(value)) {
    removePageState(key, storage);
    return;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify({ value, version });
  } catch {
    removePageState(key, storage);
    return;
  }
  if (serialized.length > MAX_PAGE_STATE_LENGTH) {
    removePageState(key, storage);
    return;
  }
  cacheMemoryState(key, serialized);
  if (storage !== "session") return;
  try {
    window.sessionStorage.setItem(key, serialized);
  } catch {
    // The bounded in-memory fallback remains available for this application session.
  }
}

export function clearScopedPageState(scope: PageStateScope) {
  const prefix = `${[PAGE_STATE_PREFIX, scope.portal, scope.role, scope.userId].map(encodeURIComponent).join(":")}:`;
  for (const key of memoryState.keys()) {
    if (key.startsWith(prefix)) memoryState.delete(key);
  }
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter(
      (key): key is string => Boolean(key?.startsWith(prefix)),
    );
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage may be blocked; the in-memory namespace was still cleared.
  }
}

export function removePageState(key: string, storage: PageStateStorage) {
  memoryState.delete(key);
  if (storage !== "session") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage may be blocked; the in-memory copy was still removed.
  }
}

export function sameSerializableValue(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}

function readRawState(key: string, storage: PageStateStorage) {
  if (storage === "session") {
    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored) {
        if (stored.length > MAX_PAGE_STATE_LENGTH) {
          window.sessionStorage.removeItem(key);
          return null;
        }
        cacheMemoryState(key, stored);
        return stored;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return memoryState.get(key) ?? null;
}

function cacheMemoryState(key: string, value: string) {
  memoryState.delete(key);
  memoryState.set(key, value);
  while (memoryState.size > MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryState.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryState.delete(oldestKey);
  }
}

function isSafePageStateValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (Array.isArray(value)) {
    seen.add(value);
    const isSafe = value.every((item) => isSafePageStateValue(item, seen));
    seen.delete(value);
    return isSafe;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const isSafe = Object.entries(value).every(
    ([key, item]) =>
      !SENSITIVE_PAGE_STATE_KEY.test(key) && isSafePageStateValue(item, seen),
  );
  seen.delete(value);
  return isSafe;
}
