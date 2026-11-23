import { describe, expect, it } from "vitest";
import {
  MAX_READ_STATE_ENTRIES,
  countUnread,
  isRequestUnread,
  loadReadState,
  markAllRequestsRead,
  markRequestRead,
  parseReadState,
  readStateStorageKey,
  requestMarker,
  saveReadState,
  serializeReadState,
  unreadLabel,
} from "@/features/alerts-monitor/model/requestReadState";

const first = { key: "ticket:1", version: "Open|2026-11-23T05:05:00Z" };
const second = { key: "alert:ALT-1", version: "New" };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("unread requests", () => {
  it("marks never-opened requests New and changed ones Updated", () => {
    expect(requestMarker(first, {})).toBe("New");
    const state = markRequestRead({}, first);
    expect(requestMarker(first, state)).toBeNull();
    expect(requestMarker({ ...first, version: "In Review|2026-11-23T06:00:00Z" }, state)).toBe("Updated");
    expect(isRequestUnread(first, state)).toBe(false);
  });

  it("counts unread requests and labels the count", () => {
    const state = markRequestRead({}, first);
    expect(countUnread([first, second], state)).toBe(1);
    expect(unreadLabel(1)).toBe("1 unread");
    expect(unreadLabel(0)).toBe("All caught up");
  });

  it("keeps the same state object when nothing changes", () => {
    const state = markRequestRead({}, first);
    expect(markRequestRead(state, first)).toBe(state);
  });

  it("marks everything read and forgets requests no longer listed", () => {
    const state = markAllRequestsRead([first, second]);
    expect(countUnread([first, second], state)).toBe(0);
    expect(Object.keys(markAllRequestsRead([second]))).toEqual(["alert:ALT-1"]);
  });

  it("keeps at most the newest entries", () => {
    let state = {};
    for (let index = 0; index < MAX_READ_STATE_ENTRIES + 5; index += 1) state = markRequestRead(state, { key: `ticket:${index}`, version: "Open" });
    expect(Object.keys(state)).toHaveLength(MAX_READ_STATE_ENTRIES);
    expect(Object.keys(state)).not.toContain("ticket:0");
    expect(Object.keys(state)).toContain(`ticket:${MAX_READ_STATE_ENTRIES + 4}`);
  });
});

describe("stored read state", () => {
  it("stores per Admin under a versioned key", () => {
    const storage = memoryStorage();
    saveReadState(storage, "admin-1", { [first.key]: first.version });
    expect(storage.values.has(readStateStorageKey("admin-1"))).toBe(true);
    expect(loadReadState(storage, "admin-1")).toEqual({ [first.key]: first.version });
    expect(loadReadState(storage, "admin-2")).toEqual({});
  });

  it("ignores broken, old-version or malformed values", () => {
    expect(parseReadState(null)).toEqual({});
    expect(parseReadState("{not json")).toEqual({});
    expect(parseReadState(JSON.stringify({ version: 0, seen: { a: "b" } }))).toEqual({});
    expect(parseReadState(JSON.stringify({ version: 1, seen: ["a"] }))).toEqual({});
    expect(parseReadState(JSON.stringify({ version: 1, seen: { a: "b", c: 3 } }))).toEqual({ a: "b" });
    expect(parseReadState(serializeReadState({ a: "b" }))).toEqual({ a: "b" });
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadReadState(broken, "admin-1")).toEqual({});
    expect(() => saveReadState(broken, "admin-1", {})).not.toThrow();
    expect(loadReadState(null, "admin-1")).toEqual({});
  });
});
