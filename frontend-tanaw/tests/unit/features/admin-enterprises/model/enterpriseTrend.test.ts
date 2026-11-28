import { describe, expect, it } from "vitest";
import { busiestDay, busiestHour, calendarDayOf, dailyTrend, formatCompact, hourlyTrend, monthlyTrend, trendNote } from "@/features/admin-enterprises/model/enterpriseTrend";
import type { IntakeReport, VisitorInsights } from "@/shared/types";

function insights(series: VisitorInsights["series"]): VisitorInsights {
  return {
    range: "today",
    scopeType: "enterprise",
    scopeId: "ENT-1",
    scopeName: "City Plaza",
    currentVisitors: 10,
    typicalVisitors: null,
    differencePercent: null,
    comparisonMessage: "",
    busiestEnterprise: null,
    busiestPeriodLabel: null,
    series,
    unusuallyBusy: [],
    lastUpdatedAt: null,
  };
}

function report(enterpriseId: string, period: string, unique: number): IntakeReport {
  return {
    id: `${enterpriseId}-${period}`,
    enterpriseId,
    enterprise: "City Plaza",
    category: "Parks",
    attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
    barangay: "Poblacion",
    month: period.split(" ")[0] ?? "",
    period,
    submitted: "",
    status: "Pending Review",
    code: "R-1",
    version: 1,
    metrics: { entry: null, exit: null, unique, peak: null },
  };
}

describe("hourly trend", () => {
  it("charts the peak visitors inside in each hour and names the busiest", () => {
    const trend = hourlyTrend(
      insights([
        { startAt: "2026-11-24T08:00:00+08:00", label: "8 AM", averageVisitors: 10, peakVisitors: 28, estimatedUniqueCount: 30 },
        { startAt: "2026-11-24T18:00:00+08:00", label: "6 PM", averageVisitors: 70, peakVisitors: 96, estimatedUniqueCount: 400 },
        { startAt: "2026-11-24T19:00:00+08:00", label: "7 PM", averageVisitors: null, peakVisitors: null },
      ]),
    );
    expect(trend.bars.map((bar) => bar.value)).toEqual([28, 96, null]);
    expect(trend.busiest?.axisLabel).toBe("6 PM");
    expect(trendNote(trend)).toBe("Busiest: 6 PM · 96 visitors inside at peak");
    expect(trend.title).toBe("Today’s Trend");
    expect(busiestHour(trend)).toEqual({ hour: "6 PM", note: "96 visitors inside at peak" });
  });

  it("takes the title of a past day", () => {
    expect(hourlyTrend(undefined, "Trend on Nov 3").title).toBe("Trend on Nov 3");
    expect(busiestHour(hourlyTrend(undefined))).toBeNull();
  });

  it("has no busiest bar without data", () => {
    const trend = hourlyTrend(undefined);
    expect(trend.bars).toEqual([]);
    expect(trendNote(trend)).toBeNull();
  });
});

describe("daily trend", () => {
  const trend = dailyTrend(
    insights([
      { startAt: "2026-11-14T00:00:00+08:00", label: "Sat, Nov 14", averageVisitors: 50, peakVisitors: 80, estimatedUniqueCount: 1240 },
      { startAt: "2026-11-23T00:00:00+08:00", label: "Mon, Nov 23", averageVisitors: 20, peakVisitors: 40, estimatedUniqueCount: 610 },
      { startAt: "2026-10-01T00:00:00+08:00", label: "Thu, Oct 1", averageVisitors: 20, peakVisitors: 40, estimatedUniqueCount: 9999 },
    ]),
    { from: "2026-10-26", to: "2026-11-24" },
  );

  it("fills every day of the range and leaves days without updates empty, not zero", () => {
    expect(trend.bars).toHaveLength(30);
    expect(trend.bars[0]?.key).toBe("2026-10-26");
    expect(trend.bars.at(-1)?.key).toBe("2026-11-24");
    expect(trend.bars.at(-1)?.value).toBeNull();
    expect(trend.bars.filter((bar) => bar.value !== null).map((bar) => bar.value)).toEqual([1240, 610]);
  });

  it("labels the axis once a week", () => {
    expect(trend.bars.filter((bar) => bar.axisLabel).map((bar) => bar.axisLabel)).toEqual(["Oct 26", "Nov 2", "Nov 9", "Nov 16", "Nov 23"]);
  });

  it("finds the busiest day for the figure strip", () => {
    expect(trendNote(trend)).toBe("Busiest: Saturday, Nov 14 · 1,240 visitors");
    expect(busiestDay(trend)).toEqual({ weekday: "Saturday", note: "Nov 14 · 1,240 visitors" });
  });

  it("labels every day of a short range and keeps only its days", () => {
    const series = [{ startAt: "2026-11-14T00:00:00+08:00", label: "Sat, Nov 14", averageVisitors: 1, peakVisitors: 1, estimatedUniqueCount: 300 }];
    const week = dailyTrend(insights(series), { from: "2026-11-12", to: "2026-11-18" });
    expect(week.title).toBe("Daily Trend");
    expect(week.bars.map((bar) => bar.axisLabel)).toEqual(["Nov 12", "Nov 13", "Nov 14", "Nov 15", "Nov 16", "Nov 17", "Nov 18"]);
    expect(week.labelEveryBar).toBe(true);
    expect(busiestDay(week)).toEqual({ weekday: "Saturday", note: "Nov 14 · 300 visitors" });
  });

  it("reads the calendar day from the timestamp text", () => {
    expect(calendarDayOf("2026-11-14T00:00:00+08:00")?.getDate()).toBe(14);
    expect(calendarDayOf("garbage")).toBeNull();
  });
});

describe("monthly trend", () => {
  it("charts this enterprise's submitted reports in month order", () => {
    const trend = monthlyTrend(
      [report("ENT-1", "October 2026", 259600), report("ENT-1", "September 2026", 212000), report("ENT-2", "October 2026", 5), report("ENT-1", "December 2025", 1000)],
      "ENT-1",
    );
    expect(trend.bars.map((bar) => bar.fullLabel)).toEqual(["December 2025", "September 2026", "October 2026"]);
    expect(trend.bars.map((bar) => bar.axisLabel)).toEqual(["Dec", "Sep", "Oct"]);
    expect(trendNote(trend)).toBe("Busiest: October 2026 · 259,600 visitors");
  });

  it("charts a month's latest version and leaves out a report awaiting correction", () => {
    const returned = { ...report("ENT-1", "October 2026", 900), status: "Returned" as const };
    const corrected = { ...report("ENT-1", "October 2026", 850), id: "ENT-1-October-v2", version: 2 };
    const awaiting = { ...report("ENT-1", "September 2026", 700), status: "Returned" as const };
    const trend = monthlyTrend([corrected, returned, awaiting, report("ENT-1", "August 2026", 600)], "ENT-1");
    expect(trend.bars.map((bar) => [bar.fullLabel, bar.value])).toEqual([
      ["August 2026", 600],
      ["October 2026", 850],
    ]);
  });

  it("keeps only the most recent months", () => {
    const reports = ["January", "February", "March", "April"].map((month) => report("ENT-1", `${month} 2026`, 10));
    expect(monthlyTrend(reports, "ENT-1", undefined, 2).bars.map((bar) => bar.axisLabel)).toEqual(["Mar", "Apr"]);
  });

  it("keeps the months the range touches", () => {
    const reports = ["January", "February", "March", "April"].map((month) => report("ENT-1", `${month} 2026`, 10));
    expect(monthlyTrend(reports, "ENT-1", { start: "2026-02-15", end: "2026-03-02" }).bars.map((bar) => bar.axisLabel)).toEqual(["Feb", "Mar"]);
    expect(monthlyTrend(reports, "ENT-1", { start: "2026-11-01", end: "2026-11-24" }).bars).toEqual([]);
  });
});

describe("chart helpers", () => {
  it("shortens large totals", () => {
    expect(formatCompact(9_999)).toBe("9,999");
    expect(formatCompact(212_000)).toBe("212K");
    expect(formatCompact(25_960)).toBe("26K");
  });
});
