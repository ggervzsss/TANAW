import { describe, expect, it } from "vitest";
import type { ApiVisitorRanking } from "@/contracts/api";
import {
  cameraWindow,
  defaultTrendPeriod,
  emptyTrendMessage,
  isLiveRange,
  paramsWithRange,
  rangeFromParams,
  rangePhrase,
  rangeVisitors,
  trendPeriodFor,
  trendPeriodsFor,
  trendSource,
  trendTitle,
} from "@/features/admin-enterprises/model/enterpriseRange";
import type { DateRange } from "@/shared/ui-kit";

// Wednesday, Nov 25, 2026. Camera history starts on Oct 27.
const today = new Date(2026, 10, 25);
const todayRange: DateRange = { preset: "today", start: "2026-11-25", end: "2026-11-25" };
const pastDay: DateRange = { preset: "custom", start: "2026-11-03", end: "2026-11-03" };
const lastWeek: DateRange = { preset: "last7", start: "2026-11-19", end: "2026-11-25" };
const october: DateRange = { preset: "month", start: "2026-10-01", end: "2026-10-31" };
const thisYear: DateRange = { preset: "year", start: "2026-01-01", end: "2026-11-25" };

function ranking(overrides: Partial<ApiVisitorRanking> = {}): ApiVisitorRanking {
  return {
    start: "2026-11-19",
    end: "2026-11-25",
    reportMonths: [],
    cameraDays: 7,
    includesToday: true,
    uncoveredDays: 0,
    enterprises: [{ enterpriseId: "ENT-1", enterpriseName: "City Plaza", barangay: "Poblacion", category: "Parks", visitors: 8640 }],
    ...overrides,
  };
}

describe("range in the address", () => {
  it("defaults to today and leaves today out of the address", () => {
    expect(rangeFromParams(new URLSearchParams(), today)).toEqual(todayRange);
    expect(paramsWithRange(new URLSearchParams("trend=daily"), todayRange, today).toString()).toBe("trend=daily");
  });

  it("writes and reads a past range, keeping other parameters", () => {
    const params = paramsWithRange(new URLSearchParams("trend=monthly"), october, today);
    expect(params.toString()).toBe("trend=monthly&range=month&from=2026-10-01&to=2026-10-31");
    expect(rangeFromParams(params, today)).toEqual(october);
  });

  it("falls back to today for a malformed, reversed or future range", () => {
    expect(rangeFromParams(new URLSearchParams("range=custom&from=2026-11-10"), today)).toEqual(todayRange);
    expect(rangeFromParams(new URLSearchParams("range=custom&from=2026-11-10&to=2026-11-01"), today)).toEqual(todayRange);
    expect(rangeFromParams(new URLSearchParams("range=custom&from=2026-11-10&to=2026-12-01"), today)).toEqual(todayRange);
    expect(rangeFromParams(new URLSearchParams("range=weekly&from=2026-11-01&to=2026-11-10"), today)).toEqual(todayRange);
  });

  it("treats only today as live", () => {
    expect(isLiveRange(todayRange, today)).toBe(true);
    expect(isLiveRange({ start: "2026-11-25", end: "2026-11-25" }, today)).toBe(true);
    expect(isLiveRange(lastWeek, today)).toBe(false);
  });
});

describe("range in words", () => {
  it("finishes a label for each kind of range", () => {
    expect(rangePhrase(todayRange, today)).toBe("today");
    expect(rangePhrase(pastDay, today)).toBe("on Nov 3");
    expect(rangePhrase({ preset: "custom", start: "2025-12-24", end: "2025-12-24" }, today)).toBe("on Dec 24, 2025");
    expect(rangePhrase(lastWeek, today)).toBe("in the last 7 days");
    expect(rangePhrase(october, today)).toBe("in October 2026");
    expect(rangePhrase({ preset: "month", start: "2026-11-01", end: "2026-11-25" }, today)).toBe("in November 2026 so far");
    expect(rangePhrase(thisYear, today)).toBe("in 2026 so far");
    expect(rangePhrase({ preset: "custom", start: "2026-11-01", end: "2026-11-20" }, today)).toBe("from Nov 1 to Nov 20");
  });
});

describe("camera history", () => {
  it("clips a range to the last 30 days and says when it did", () => {
    expect(cameraWindow(lastWeek, today)).toEqual({ from: "2026-11-19", to: "2026-11-25", clipped: false });
    expect(cameraWindow(october, today)).toEqual({ from: "2026-10-27", to: "2026-10-31", clipped: true });
    expect(cameraWindow({ start: "2026-09-01", end: "2026-10-26" }, today)).toBeNull();
  });
});

describe("trend period", () => {
  it("offers hourly for one day, daily or monthly for longer ranges", () => {
    expect(trendPeriodsFor(pastDay)).toEqual(["hourly"]);
    expect(trendPeriodsFor(lastWeek)).toEqual(["daily", "monthly"]);
  });

  it("defaults to monthly when camera history covers less than half the range", () => {
    expect(defaultTrendPeriod(todayRange, today)).toBe("hourly");
    expect(defaultTrendPeriod(lastWeek, today)).toBe("daily");
    expect(defaultTrendPeriod({ start: "2026-10-20", end: "2026-11-25" }, today)).toBe("daily");
    expect(defaultTrendPeriod(october, today)).toBe("monthly");
    expect(defaultTrendPeriod(thisYear, today)).toBe("monthly");
  });

  it("keeps a requested period only when it fits the range", () => {
    expect(trendPeriodFor("monthly", lastWeek, today)).toBe("monthly");
    expect(trendPeriodFor("daily", thisYear, today)).toBe("daily");
    expect(trendPeriodFor("daily", pastDay, today)).toBe("hourly");
    expect(trendPeriodFor("hourly", lastWeek, today)).toBe("daily");
  });

  it("titles and explains the chart for the range", () => {
    expect(trendTitle("hourly", todayRange, today)).toBe("Today’s Trend");
    expect(trendTitle("hourly", pastDay, today)).toBe("Trend on Nov 3");
    expect(trendTitle("daily", lastWeek, today)).toBe("Daily Trend");
    expect(trendSource("hourly", pastDay, today)).toBe("Most visitors inside at once in each hour on Nov 3.");
    expect(trendSource("daily", lastWeek, today)).toBe("Estimated visitors on each day in the last 7 days.");
    expect(trendSource("daily", october, today)).toBe("Estimated visitors on each day, Oct 27 – 31, 2026. Camera history covers the last 30 days only.");
    expect(trendSource("monthly", thisYear, today)).toBe("Visitors stated in each submitted monthly report in 2026 so far.");
  });

  it("says why a chart is empty", () => {
    expect(emptyTrendMessage("hourly", todayRange, today)).toBe("No camera counts have arrived today yet.");
    expect(emptyTrendMessage("hourly", pastDay, today)).toBe("No camera counts were recorded on Nov 3.");
    expect(emptyTrendMessage("hourly", { preset: "custom", start: "2026-10-03", end: "2026-10-03" }, today)).toBe(
      "Camera history covers the last 30 days, so there are no camera counts on Oct 3. Monthly reports cover older months.",
    );
    expect(emptyTrendMessage("daily", lastWeek, today)).toBe("No daily counts in the last 7 days.");
    expect(emptyTrendMessage("monthly", lastWeek, today)).toBe("No monthly report has been submitted for these months.");
  });
});

describe("visitors in the range", () => {
  it("reads this enterprise's total and where it came from", () => {
    expect(rangeVisitors(ranking(), "ENT-1")).toEqual({ value: 8640, note: "From camera counts" });
    expect(rangeVisitors(ranking({ reportMonths: ["2026-10"], cameraDays: 0 }), "ENT-1").note).toBe("From the monthly report");
    expect(rangeVisitors(ranking({ reportMonths: ["2026-09", "2026-10"], cameraDays: 25 }), "ENT-1").note).toBe("From monthly reports and camera counts");
  });

  it("says when older days were left out", () => {
    expect(rangeVisitors(ranking({ uncoveredDays: 40 }), "ENT-1").note).toBe("From camera counts. Days older than 30 days without a monthly report are not counted");
  });

  it("shows no number when nothing counted this enterprise", () => {
    expect(rangeVisitors(ranking(), "ENT-2")).toEqual({ value: null, note: "No visitors counted for this enterprise in this range" });
    expect(rangeVisitors(ranking({ cameraDays: 0, enterprises: [] }), "ENT-1")).toEqual({ value: null, note: "No monthly report or camera count covers this range" });
  });
});
