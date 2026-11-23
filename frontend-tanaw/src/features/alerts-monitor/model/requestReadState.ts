/*
 * Read and unread on the Requests screen. The API has no per-Admin read flag for alerts, tickets or
 * profile changes, so each Admin's browser remembers which version of each request they opened, in
 * localStorage under their account id. A request never opened is "New"; one that changed after it was
 * opened is "Updated". Another browser or a cleared storage starts again with everything unread.
 */
import type { AdminRequest } from "./adminRequests";

/** Request key → the version the Admin last opened. */
export type RequestReadState = Record<string, string>;
export type RequestMarker = "New" | "Updated";

export const READ_STATE_VERSION = 1;
/** Keeps the stored map small; the oldest entries are dropped first. */
export const MAX_READ_STATE_ENTRIES = 500;

export function readStateStorageKey(userId: string) {
  return `tanaw:admin-requests:read:v${READ_STATE_VERSION}:${userId}`;
}

export function requestMarker(request: Pick<AdminRequest, "key" | "version">, state: RequestReadState): RequestMarker | null {
  const seen = state[request.key];
  if (seen === undefined) return "New";
  return seen === request.version ? null : "Updated";
}

export function isRequestUnread(request: Pick<AdminRequest, "key" | "version">, state: RequestReadState) {
  return requestMarker(request, state) !== null;
}

export function countUnread(requests: readonly Pick<AdminRequest, "key" | "version">[], state: RequestReadState) {
  return requests.reduce((total, request) => total + (isRequestUnread(request, state) ? 1 : 0), 0);
}

export function unreadLabel(count: number) {
  return count === 0 ? "All caught up" : `${count} unread`;
}

export function markRequestRead(state: RequestReadState, request: Pick<AdminRequest, "key" | "version">): RequestReadState {
  if (state[request.key] === request.version) return state;
  const next = { ...state };
  delete next[request.key];
  next[request.key] = request.version;
  return trimReadState(next);
}

/** Marks every listed request read and forgets requests that are no longer listed. */
export function markAllRequestsRead(requests: readonly Pick<AdminRequest, "key" | "version">[]): RequestReadState {
  return trimReadState(Object.fromEntries(requests.map((request) => [request.key, request.version])));
}

function trimReadState(state: RequestReadState): RequestReadState {
  const entries = Object.entries(state);
  if (entries.length <= MAX_READ_STATE_ENTRIES) return state;
  return Object.fromEntries(entries.slice(entries.length - MAX_READ_STATE_ENTRIES));
}

export function parseReadState(raw: string | null): RequestReadState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; seen?: unknown };
    if (parsed.version !== READ_STATE_VERSION || !parsed.seen || typeof parsed.seen !== "object" || Array.isArray(parsed.seen)) return {};
    return Object.fromEntries(Object.entries(parsed.seen as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function serializeReadState(state: RequestReadState) {
  return JSON.stringify({ version: READ_STATE_VERSION, seen: state });
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export function loadReadState(storage: KeyValueStorage | null, userId: string): RequestReadState {
  if (!storage) return {};
  try {
    return parseReadState(storage.getItem(readStateStorageKey(userId)));
  } catch {
    return {};
  }
}

export function saveReadState(storage: KeyValueStorage | null, userId: string, state: RequestReadState) {
  if (!storage) return;
  try {
    storage.setItem(readStateStorageKey(userId), serializeReadState(state));
  } catch {
    // Storage may be full or blocked; read marks then last for this visit only.
  }
}
