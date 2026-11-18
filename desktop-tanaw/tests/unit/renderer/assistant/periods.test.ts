import { describe, expect, it } from "vitest";
import { isSingleDay, periodRange, previousRange } from "../../../../src/features/dashboard/assistant/periods";

// 00:30 on 18 November 2026 in Manila is still 17 November in UTC.
const JUST_AFTER_MANILA_MIDNIGHT = new Date("2026-11-17T16:30:00Z");

describe("assistant periods", () => {
  it("uses Asia/Manila business days", () => {
    expect(periodRange("today", JUST_AFTER_MANILA_MIDNIGHT)).toEqual({ start: "2026-11-17T16:00:00.000Z", end: "2026-11-18T16:00:00.000Z" });
    expect(periodRange("yesterday", JUST_AFTER_MANILA_MIDNIGHT)).toEqual({ start: "2026-11-16T16:00:00.000Z", end: "2026-11-17T16:00:00.000Z" });
  });

  it("matches the dashboard's past 7 and 30 days, including today", () => {
    expect(periodRange("week", JUST_AFTER_MANILA_MIDNIGHT)).toEqual({ start: "2026-11-11T16:00:00.000Z", end: "2026-11-18T16:00:00.000Z" });
    expect(periodRange("month", JUST_AFTER_MANILA_MIDNIGHT)).toEqual({ start: "2026-10-19T16:00:00.000Z", end: "2026-11-18T16:00:00.000Z" });
  });

  it("finds the equal-length period immediately before", () => {
    expect(previousRange(periodRange("today", JUST_AFTER_MANILA_MIDNIGHT))).toEqual(periodRange("yesterday", JUST_AFTER_MANILA_MIDNIGHT));
    expect(previousRange(periodRange("week", JUST_AFTER_MANILA_MIDNIGHT))).toEqual({ start: "2026-11-04T16:00:00.000Z", end: "2026-11-11T16:00:00.000Z" });
  });

  it("knows which periods are a single day", () => {
    expect(["today", "yesterday", "week", "month"].map((period) => isSingleDay(period as never))).toEqual([true, true, false, false]);
  });
});
