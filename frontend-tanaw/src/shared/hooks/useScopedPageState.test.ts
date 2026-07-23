import { afterEach, describe, expect, it, vi } from "vitest";
import { clearScopedPageState, createPageStateKey, readPageState, writePageState } from "../utils/pageState";

describe("scoped page state", () => {
  afterEach(() => vi.unstubAllGlobals());

  const scope = { portal: "web", role: "staff", userId: "user-1" };
  const key = createPageStateKey(scope, "/staff/batch-reports", "filters");
  const isFilters = (value: unknown): value is { month: string } =>
    Boolean(value && typeof value === "object" && "month" in value && typeof value.month === "string");

  it("restores only compatible versioned state", () => {
    writePageState(key, 1, { month: "June" }, "memory");
    expect(readPageState(key, 1, isFilters, "memory")).toEqual({ month: "June" });
    expect(readPageState(key, 2, isFilters, "memory")).toBeNull();
  });

  it("isolates users and clears only the requested namespace", () => {
    const anotherKey = createPageStateKey({ ...scope, userId: "user-10" }, "/staff/batch-reports", "filters");
    writePageState(key, 1, { month: "June" }, "memory");
    writePageState(anotherKey, 1, { month: "July" }, "memory");
    clearScopedPageState(scope);
    expect(readPageState(key, 1, isFilters, "memory")).toBeNull();
    expect(readPageState(anotherKey, 1, isFilters, "memory")).toEqual({ month: "July" });
  });

  it("drops oversized state instead of growing session data without a bound", () => {
    writePageState(key, 1, { month: "x".repeat(128 * 1024) }, "memory");
    expect(readPageState(key, 1, isFilters, "memory")).toBeNull();
  });

  it("falls back to memory when session storage is blocked", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    writePageState(key, 1, { month: "June" });
    expect(readPageState(key, 1, isFilters)).toEqual({ month: "June" });
  });

  it("refuses sensitive field names", () => {
    const sensitiveKey = createPageStateKey(scope, "/account", "draft");
    const isSensitive = (value: unknown): value is { password: string } =>
      Boolean(value && typeof value === "object" && "password" in value);
    writePageState(sensitiveKey, 1, { password: "must-not-persist" }, "memory");
    expect(readPageState(sensitiveKey, 1, isSensitive, "memory")).toBeNull();
  });

  it("ignores malformed values", () => {
    writePageState(key, 1, { month: 7 }, "memory");
    expect(readPageState(key, 1, isFilters, "memory")).toBeNull();
  });
});
