import { describe, expect, it } from "vitest";
import { calendarDays, customRange, formatRangeLabel, formatRangeText, isInDateRange, presetRange, rangeEndMonth, rangeNote } from "@/shared/ui-kit/lib/dateRange";
import { visiblePages } from "@/shared/ui-kit";

const today = new Date(2026, 10, 23, 15, 0);

describe("date range presets", () => {
  it("builds today, last 7 days, month and year ranges ending today", () => {
    expect(presetRange("today", today)).toEqual({ preset: "today", start: "2026-11-23", end: "2026-11-23" });
    expect(presetRange("last7", today)).toEqual({ preset: "last7", start: "2026-11-17", end: "2026-11-23" });
    expect(presetRange("month", today)).toEqual({ preset: "month", start: "2026-11-01", end: "2026-11-23" });
    expect(presetRange("month", today, { year: 2026, monthIndex: 9 })).toEqual({ preset: "month", start: "2026-10-01", end: "2026-10-31" });
    expect(presetRange("year", today)).toEqual({ preset: "year", start: "2026-01-01", end: "2026-11-23" });
  });

  it("orders a custom range picked end-first", () => {
    expect(customRange("2026-11-09", "2026-11-03")).toEqual({ preset: "custom", start: "2026-11-03", end: "2026-11-09" });
  });
});

describe("date range text", () => {
  it("formats labels and range text", () => {
    expect(formatRangeLabel(presetRange("month", today))).toBe("November 2026");
    expect(formatRangeLabel(presetRange("year", today))).toBe("Year 2026");
    expect(formatRangeLabel(customRange("2026-11-03", "2026-11-09"))).toBe("Nov 3 – 9");
    expect(formatRangeText({ start: "2026-11-01", end: "2026-11-23" })).toBe("Nov 1 – 23, 2026");
    expect(formatRangeText({ start: "2025-12-20", end: "2026-01-05" })).toBe("Dec 20, 2025 – Jan 5, 2026");
    expect(formatRangeText({ start: "2026-11-05", end: "2026-11-05" })).toBe("Nov 5, 2026");
  });

  it("explains the range in the footer note", () => {
    expect(rangeNote(presetRange("month", today), today)).toBe("This month so far");
    expect(rangeNote(presetRange("month", today, { year: 2026, monthIndex: 9 }), today)).toBe("Whole month");
    expect(rangeNote(customRange("2026-11-03", "2026-11-09"), today)).toBe("7 days. Select two dates to change it");
  });
});

describe("date range helpers", () => {
  it("checks whether a timestamp falls on a day in the range", () => {
    const range = { start: "2026-11-01", end: "2026-11-23" };
    expect(isInDateRange(new Date(2026, 10, 23, 23, 30), range)).toBe(true);
    expect(isInDateRange(new Date(2026, 10, 24, 0, 5), range)).toBe(false);
    expect(isInDateRange("2026-10-31", range)).toBe(false);
  });

  it("reports the month of the range's last day and fills whole calendar weeks", () => {
    expect(rangeEndMonth({ end: "2026-10-31" })).toEqual({ year: 2026, monthIndex: 9, month: "October" });
    const november = calendarDays(2026, 10);
    expect(november.length % 7).toBe(0);
    expect(november[0]).toMatchObject({ iso: "2026-11-01", inMonth: true, weekday: 0 });
  });

  it("shows every page up to seven and a window around the current page after that", () => {
    expect(visiblePages(2, 3)).toEqual([1, 2, 3]);
    expect(visiblePages(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
  });
});
