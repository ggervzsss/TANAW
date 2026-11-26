import { describe, expect, it } from "vitest";
import {
  addDays,
  assistantFilter,
  businessDate,
  monthGrid,
  normalizeRange,
  presetRange,
  rangeBounds,
  rangeLabel,
  rangeLength,
  rangePhrase,
} from "../../../../../src/features/dashboard/utils/dashboard-range";

describe("dashboard dates", () => {
  it("uses the Manila date even before the UTC date changes", () => {
    expect(businessDate(new Date("2026-11-10T17:00:00Z"))).toBe("2026-11-11");
    expect(businessDate(new Date("2026-11-10T15:59:00Z"))).toBe("2026-11-10");
  });

  it("asks the local service for Manila midnight to the midnight after the last day", () => {
    expect(rangeBounds({ from: "2026-11-11", to: "2026-11-11" })).toEqual({ start: "2026-11-10T16:00:00.000Z", end: "2026-11-11T16:00:00.000Z" });
    expect(rangeBounds({ from: "2026-11-05", to: "2026-11-11" }).start).toBe("2026-11-04T16:00:00.000Z");
  });

  it("builds the quick ranges from today", () => {
    const today = "2026-11-16";
    expect(presetRange("today", today)).toEqual({ from: today, to: today, preset: "today" });
    expect(presetRange("yesterday", today)).toMatchObject({ from: "2026-11-15", to: "2026-11-15" });
    expect(rangeLength(presetRange("week", today))).toBe(7);
    expect(rangeLength(presetRange("month", today))).toBe(30);
    expect(presetRange("thisMonth", today)).toMatchObject({ from: "2026-11-01", to: today });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("labels and phrases ranges the way people read them", () => {
    const today = "2026-11-16";
    expect(rangeLabel({ from: today, to: today }, today)).toBe("Today, November 16, 2026");
    expect(rangeLabel({ from: "2026-11-15", to: "2026-11-15" }, today)).toBe("Yesterday, November 15, 2026");
    expect(rangeLabel({ from: "2026-11-14", to: "2026-11-14" }, today)).toBe("Saturday, November 14, 2026");
    expect(rangeLabel({ from: "2026-11-10", to: today }, today)).toBe("Nov 10 to 16, 2026");
    expect(rangeLabel({ from: "2026-10-18", to: today }, today)).toBe("Oct 18 to Nov 16, 2026");
    expect(rangePhrase({ from: "2026-11-10", to: today }, today)).toBe("from Nov 10 to Nov 16");
    expect(rangePhrase({ from: today, to: today }, today)).toBe("today");
  });

  it("orders a picked range and caps its length", () => {
    expect(normalizeRange("2026-11-12", "2026-11-03")).toEqual({ from: "2026-11-03", to: "2026-11-12" });
    expect(rangeLength(normalizeRange("2026-01-01", "2026-06-01"))).toBe(31);
  });

  it("lays out a month Sunday first with blanks around it", () => {
    const november = monthGrid(2026, 10);
    expect(november[0][0]).toBe("2026-11-01");
    expect(november.flat().filter(Boolean)).toHaveLength(30);
    const weeks = monthGrid(2026, 9);
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0][4]).toBe("2026-10-01");
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("tells TANAW Insights which period to assume", () => {
    expect(assistantFilter({ from: "2026-11-16", to: "2026-11-16" })).toBe("Today");
    expect(assistantFilter({ from: "2026-11-10", to: "2026-11-16" })).toBe("Week");
    expect(assistantFilter({ from: "2026-10-18", to: "2026-11-16" })).toBe("Month");
  });
});
