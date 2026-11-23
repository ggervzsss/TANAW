import { describe, expect, it } from "vitest";
import { highestPoint, niceAxisMax, peakLabel, peakPoints, peakSubtitle, peakWindowFor } from "@/features/admin-dashboard/model/peakOccupancy";

const today = new Date(2026, 10, 23);

describe("peak occupancy window", () => {
  it("maps a range to the smallest visitor-insights window", () => {
    expect(peakWindowFor({ start: "2026-11-23", end: "2026-11-23" }, today)).toEqual({ window: "today", from: "2026-11-23", to: "2026-11-23", clipped: false });
    expect(peakWindowFor({ start: "2026-11-17", end: "2026-11-23" }, today)?.window).toBe("7d");
    expect(peakWindowFor({ start: "2026-11-01", end: "2026-11-23" }, today)?.window).toBe("30d");
    expect(peakWindowFor({ start: "2026-01-01", end: "2026-11-23" }, today)).toEqual({ window: "30d", from: "2026-10-25", to: "2026-11-23", clipped: true });
    expect(peakWindowFor({ start: "2026-08-01", end: "2026-08-31" }, today)).toBeNull();
  });

  it("says what is shown", () => {
    expect(peakSubtitle(peakWindowFor({ start: "2026-11-23", end: "2026-11-23" }, today))).toBe("People inside today, from live camera counts");
    expect(peakSubtitle(peakWindowFor({ start: "2026-11-05", end: "2026-11-05" }, today))).toBe("Highest number inside on Nov 5, 2026, from camera counts");
    expect(peakSubtitle(peakWindowFor({ start: "2026-11-01", end: "2026-11-23" }, today))).toBe("Highest number inside each day, Nov 1 – 23, 2026");
    expect(peakSubtitle(peakWindowFor({ start: "2026-01-01", end: "2026-11-23" }, today))).toContain("covers the last 30 days only");
    expect(peakSubtitle(null)).toContain("Camera history covers the last 30 days");
  });
});

describe("peak occupancy points", () => {
  const series = [
    { startAt: "2026-11-20T00:00:00+08:00", label: "Fri, Nov 20", averageVisitors: 10, peakVisitors: 80, estimatedUniqueCount: 100 },
    { startAt: "2026-11-21T00:00:00+08:00", label: "Sat, Nov 21", averageVisitors: 10, peakVisitors: 120, estimatedUniqueCount: 100 },
    { startAt: "2026-11-22T00:00:00+08:00", label: "Sun, Nov 22", averageVisitors: 10, peakVisitors: null, estimatedUniqueCount: 100 },
    { startAt: "2026-11-23T00:00:00+08:00", label: "Mon, Nov 23", averageVisitors: 10, peakVisitors: 120, estimatedUniqueCount: 100 },
  ];

  it("keeps daily points inside the range and finds the earliest highest one", () => {
    const window = peakWindowFor({ start: "2026-11-21", end: "2026-11-23" }, today)!;
    const points = peakPoints(series, window, "12-hour");
    expect(points.map(({ label, value }) => [label, value])).toEqual([
      ["Nov 21", 120],
      ["Nov 23", 120],
    ]);
    expect(peakLabel(highestPoint(points)!, window)).toBe("Peak 120 on Nov 21");
  });

  it("labels hourly points for today", () => {
    const window = peakWindowFor({ start: "2026-11-23", end: "2026-11-23" }, today)!;
    const points = peakPoints([{ startAt: "2026-11-23T13:00:00+08:00", label: "1 PM", averageVisitors: 3, peakVisitors: 74 }], window, "12-hour");
    expect(peakLabel(points[0], window)).toBe("Peak 74 at 1 PM");
  });

  it("rounds the axis top", () => {
    expect([niceAxisMax(0), niceAxisMax(74), niceAxisMax(120), niceAxisMax(260), niceAxisMax(1_050), niceAxisMax(12_300)]).toEqual([20, 80, 150, 300, 1_200, 15_000]);
  });
});
