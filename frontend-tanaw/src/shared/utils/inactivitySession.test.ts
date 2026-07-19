import { describe, expect, it } from "vitest";
import { getInactivitySnapshot, INACTIVITY_COUNTDOWN_MS, INACTIVITY_WARNING_AFTER_MS } from "./inactivitySession";

describe("inactivity session timing", () => {
  it("warns after five minutes and expires after the sixty-second countdown", () => {
    const startedAt = 1_000;

    expect(getInactivitySnapshot(startedAt, startedAt + INACTIVITY_WARNING_AFTER_MS - 1)).toEqual({ phase: "active", remainingSeconds: 60 });
    expect(getInactivitySnapshot(startedAt, startedAt + INACTIVITY_WARNING_AFTER_MS)).toEqual({ phase: "warning", remainingSeconds: 60 });
    expect(getInactivitySnapshot(startedAt, startedAt + INACTIVITY_WARNING_AFTER_MS + INACTIVITY_COUNTDOWN_MS - 1)).toEqual({ phase: "warning", remainingSeconds: 1 });
    expect(getInactivitySnapshot(startedAt, startedAt + INACTIVITY_WARNING_AFTER_MS + INACTIVITY_COUNTDOWN_MS)).toEqual({ phase: "expired", remainingSeconds: 0 });
  });
});
