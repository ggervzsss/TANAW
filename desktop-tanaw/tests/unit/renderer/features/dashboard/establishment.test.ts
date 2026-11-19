import { describe, expect, it } from "vitest";
import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentSummary } from "../../../../../src/features/camera/services/establishment.types";
import { establishmentRange, establishmentTrend, hourlyOccupancyTrend, periodDemographics, rangeMonths } from "../../../../../src/features/dashboard/utils/establishment";
import { getDemographicTotals } from "../../../../../src/features/reports/utils/demographics";

describe("unified establishment history", () => {
  it("uses Manila dates even when the UTC date has not changed yet", () => {
    expect(establishmentRange("Today", new Date("2026-11-10T17:00:00Z"))).toEqual({ start: "2026-11-10T16:00:00.000Z", end: "2026-11-11T16:00:00.000Z" });
    expect(establishmentRange("Week", new Date("2026-11-10T17:00:00Z")).start).toBe("2026-11-04T16:00:00.000Z");
  });

  it("leaves missing dates as gaps while retaining observed zero activity", () => {
    const range = { start: "2026-11-08T16:00:00Z", end: "2026-11-10T16:00:00Z" };
    const days = [{ business_date: "2026-11-10", covered_ms: 1000, qualified_observations: 0, identification_state: "available", unique_count: 0, peak_occupancy: 0 }] as DailyEstablishmentMetrics[];
    const points = establishmentTrend({ days } as EstablishmentSummary, range);
    expect(points[0]).toMatchObject({ date: "2026-11-09", visitors: null, occupancy: null });
    expect(points[1]).toMatchObject({ date: "2026-11-10", visitors: 0, occupancy: 0 });
  });

  it("does not turn missing identification into zero visitors", () => {
    const days = [{ business_date: "2026-11-10", covered_ms: 1000, qualified_observations: 3, identification_state: "unavailable", unique_count: 0, peak_occupancy: 3 }] as DailyEstablishmentMetrics[];
    const [point] = establishmentTrend({ days } as EstablishmentSummary, { start: "2026-11-09T16:00:00Z", end: "2026-11-10T16:00:00Z" });
    expect(point.visitors).toBeNull();
    expect(point.occupancy).toBe(3);
  });
});

it("retains a directly observed brief peak before an interval can accumulate coverage", () => {
  const day = { business_date: "2026-11-10", covered_ms: 0, qualified_observations: 1, identification_state: "available", unique_count: 1, peak_occupancy: 1 } as DailyEstablishmentMetrics;
  const [point] = establishmentTrend({ days: [day] } as EstablishmentSummary, { start: "2026-11-09T16:00:00Z", end: "2026-11-10T16:00:00Z" });
  expect(point).toMatchObject({ visitors: 1, occupancy: 1 });
});

describe("hourly occupancy for today", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, area_visits: 0, peak_occupancy: null as number | null, covered_ms: 0 }));
  const hourly = (values: Record<number, number | null>, state: EstablishmentHourly["state"] = "available") =>
    ({ state, hours: hours.map((hour) => (hour.hour in values ? { ...hour, peak_occupancy: values[hour.hour], covered_ms: 3_600_000 } : hour)) }) as EstablishmentHourly;

  it("spans the first to the last observed hour and keeps unobserved hours as gaps", () => {
    const points = hourlyOccupancyTrend(hourly({ 7: 2, 8: 5, 10: 9 }), "12-hour");
    expect(points.map((point) => point.label)).toEqual(["7 AM", "8 AM", "9 AM", "10 AM"]);
    expect(points.map((point) => point.occupancy)).toEqual([2, 5, null, 9]);
    expect(hourlyOccupancyTrend(hourly({ 13: 4 }), "24-hour")).toEqual([{ label: "13:00", occupancy: 4 }]);
  });

  it("has no points when nothing was observed", () => {
    expect(hourlyOccupancyTrend(hourly({}), "12-hour")).toEqual([]);
    expect(hourlyOccupancyTrend(null, "12-hour")).toEqual([]);
  });
});

describe("demographics for the selected period", () => {
  const day = (business_date: string, unique_count: number, male_count: number) =>
    ({ business_date, covered_ms: 1000, qualified_observations: unique_count, identification_state: "available", unique_count, male_count, female_count: unique_count - male_count }) as DailyEstablishmentMetrics;

  it("names every month a range touches", () => {
    expect(rangeMonths(establishmentRange("Week", new Date("2026-11-03T04:00:00Z")))).toEqual(["October 2026", "November 2026"]);
    expect(rangeMonths(establishmentRange("Today", new Date("2026-11-19T04:00:00Z")))).toEqual(["November 2026"]);
  });

  it("counts the period's visitors by sex and moves confirmed other origins out of This Province", () => {
    const summary = { unique_count: 30, days: [day("2026-10-31", 10, 6), day("2026-11-01", 20, 9)] } as EstablishmentSummary;
    const origins = { "2026-10-31": { otherCity: { male: 1, female: 0 }, otherProvince: { male: 1, female: 1 }, foreign: { male: 0, female: 1 } } };

    const result = periodDemographics(summary, origins);
    const totals = getDemographicTotals(result!.demo);

    expect(totals.grandTotal).toBe(30);
    expect(totals.male).toBe(15);
    expect(totals.female).toBe(15);
    expect(totals.otherProvince).toBe(2);
    expect(totals.foreign).toBe(1);
    expect(totals.thisProvince).toBe(27);
    expect(result!.unconfirmedDays).toBe(1);
  });

  it("is empty until counts load", () => {
    expect(periodDemographics(null, {})).toBeNull();
  });
});
