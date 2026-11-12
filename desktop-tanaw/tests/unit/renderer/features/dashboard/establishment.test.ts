import { describe, expect, it } from "vitest";
import type { DailyEstablishmentMetrics, EstablishmentSummary } from "../../../../../src/features/camera/services/establishment.types";
import { establishmentRange, establishmentTrend } from "../../../../../src/features/dashboard/utils/establishment";

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
