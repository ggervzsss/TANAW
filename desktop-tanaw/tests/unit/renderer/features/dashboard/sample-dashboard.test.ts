import { describe, expect, it } from "vitest";
import { sampleDashboard } from "../../../../../src/features/dashboard/sample/sample-dashboard";
import { presetRange } from "../../../../../src/features/dashboard/utils/dashboard-range";
import { busiestIndex, hourlyTraffic } from "../../../../../src/features/dashboard/utils/traffic";

describe("sample dashboard data", () => {
  const today = "2026-11-25";

  it("fills today only up to the current time and gives four earlier weeks of history", () => {
    const sample = sampleDashboard(presetRange("today", today), today, 15.5);
    const hours = sample.hourly!.hours;
    expect(hours.find((hour) => hour.hour === 10)!.entries).toBeGreaterThan(0);
    expect(hours.find((hour) => hour.hour === 17)!.entries).toBe(0);
    expect(hours.find((hour) => hour.hour === 17)!.covered_ms).toBe(0);
    expect(sample.usualHours).toHaveLength(4);
    const points = hourlyTraffic(sample.hourly, sample.usualHours, "12-hour");
    expect(points.every((point) => point.usual !== null)).toBe(true);
    expect(busiestIndex(points)).toBeGreaterThanOrEqual(0);
  });

  it("gives each day of a range its entries and stays the same between refreshes", () => {
    const range = presetRange("week", today);
    const first = sampleDashboard(range, today, 20);
    expect(first.summary.days).toHaveLength(7);
    expect(first.summary.entries).toBe(first.summary.days.reduce((sum, day) => sum + day.entries, 0));
    expect(first.usualDays!.days.length).toBeGreaterThanOrEqual(28);
    expect(sampleDashboard(range, today, 20).summary.entries).toBe(first.summary.entries);
  });

  it("shows one camera down so every state of the dashboard is visible", () => {
    const sample = sampleDashboard(presetRange("today", today), today, 12);
    expect(sample.cameras).toHaveLength(5);
    expect(sample.live.missing_camera_ids).toEqual([9003]);
    expect(sample.reports.length).toBeGreaterThan(5);
    expect(sample.marks["9003"]).toMatchObject({ counting: false });
  });
});
