import { describe, expect, it } from "vitest";
import { clearScopedPageState, createPageStateKey, readPageState, writePageState } from "../utils/page-state";

describe("desktop scoped page state", () => {
  const scope = { portal: "desktop", role: "enterprise", userId: "enterprise-1" };
  const key = createPageStateKey(scope, "/enterprise/tickets", "sort");
  const isSort = (value: unknown): value is string => value === "recommended" || value === "newest";

  it("versions, validates, and clears user-scoped in-memory state", () => {
    writePageState(key, 1, "newest", "memory");
    const prefixCollisionKey = createPageStateKey(
      { ...scope, userId: "enterprise-10" },
      "/enterprise/tickets",
      "sort",
    );
    writePageState(prefixCollisionKey, 1, "newest", "memory");
    expect(readPageState(key, 1, isSort, "memory")).toBe("newest");
    expect(readPageState(key, 2, isSort, "memory")).toBeNull();
    clearScopedPageState(scope);
    expect(readPageState(key, 1, isSort, "memory")).toBeNull();
    expect(readPageState(prefixCollisionKey, 1, isSort, "memory")).toBe("newest");
  });

  it("refuses camera password fields", () => {
    const passwordKey = createPageStateKey(
      scope,
      "/enterprise/camera",
      "draft",
    );
    const isPasswordDraft = (value: unknown): value is { cameraPassword: string } =>
      Boolean(value && typeof value === "object" && "cameraPassword" in value);
    writePageState(passwordKey, 1, { cameraPassword: "must-not-persist" }, "memory");
    expect(readPageState(passwordKey, 1, isPasswordDraft, "memory")).toBeNull();
  });
});
