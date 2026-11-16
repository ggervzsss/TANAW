import { describe, expect, it } from "vitest";
import { hasUnspecifiedCity, var1DailyCells, var1DataNotes, var1Days, var1MonthlyCells } from "../../../../../../src/features/reports/model/var1";
import { demoFromPayload, emptyDemo } from "../../../../../../src/features/reports/model/report-workspace";
import { monthlyDemoFromDays, reportDays } from "../../../../../../src/features/reports/model/daily-origins";
import { getDemographicAllocationStatus, getDemographicTotals } from "../../../../../../src/features/reports/utils/demographics";
import type { DailyOrigins, Metrics } from "../../../../../../src/types/enterprise";

const metrics: Metrics = { entries: null, exits: null, peak: null, unique: 100 };
const day = (business_date: string, unique_count: number, covered_ms = 1000) => ({
  business_date,
  covered_ms,
  qualified_observations: unique_count,
  identification_state: covered_ms ? "available" : "unavailable",
  unique_count,
});

describe("official VAR 1 data mapping", () => {
  it.each([
    ["February 2024", 29],
    ["February 2025", 28],
    ["April 2026", 30],
    ["May 2026", 31],
  ])("includes every valid day of %s", (period, length) => {
    const days = var1Days(String(period), metrics);
    expect(days).toHaveLength(Number(length));
    expect(days[0].day).toBe(1);
    expect(days.at(-1)?.day).toBe(length);
    expect(days.every((item) => item.unique === null)).toBe(true);
  });

  it("keeps observed zero separate from missing daily records", () => {
    const data = { ...metrics, counting: { days: [day("2026-05-01", 0), day("2026-05-02", 4), day("2026-05-03", 0, 0)] } } as unknown as Metrics;
    const days = var1Days("May 2026", data);
    expect(days.slice(0, 4).map((item) => item.unique)).toEqual([0, 4, null, null]);
    expect(days[0].weekday).toBe("Fri");
    expect(var1Days("Invalid month", data)).toEqual([]);
  });

  it("fills each day's residence groups from daily origins; This City has a total only", () => {
    const data = { ...metrics, unique: 10, counting: { days: [day("2026-05-02", 10)] } } as unknown as Metrics;
    const origins: DailyOrigins = {
      "2026-05-02": { otherCity: { male: 2, female: 1 }, otherProvince: { male: 1, female: 0 }, foreign: { male: 0, female: 1 } },
    };
    const [, second] = var1Days("May 2026", data, origins);
    expect(var1DailyCells(second, true)).toEqual([null, null, 5, 2, 1, 3, 1, 0, 1, 0, 1, 1, 3, 2, 10]);
    expect(var1DailyCells(second, false)).toEqual([...Array(14).fill(null), 10]);
  });

  it("derives monthly totals that match the unique count, with This City sex unspecified", () => {
    const data = { ...metrics, unique: 30, counting: { days: [day("2026-05-01", 10), day("2026-05-02", 20)] } } as unknown as Metrics;
    const origins: DailyOrigins = {
      "2026-05-01": { otherCity: { male: 2, female: 1 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } },
      "2026-05-02": { otherCity: { male: 0, female: 0 }, otherProvince: { male: 3, female: 2 }, foreign: { male: 1, female: 0 } },
    };
    const demo = monthlyDemoFromDays(reportDays("May 2026", data, origins, "2026-05-31"));
    expect(getDemographicTotals(demo)).toMatchObject({ grandTotal: 30, male: 6, female: 3, unspecified: 21 });
    expect(getDemographicAllocationStatus(demo, 30).isComplete).toBe(true);
    expect(var1MonthlyCells(demo, data)).toEqual([null, null, 21, 2, 1, 3, 3, 2, 5, 1, 0, 1, 6, 3, 30]);
    expect(hasUnspecifiedCity(demo)).toBe(false);
    expect(var1DataNotes(demo, origins)[0]).toContain("This City is counted by TANAW");
  });

  it("preserves province-only totals as unspecified rather than inventing a city split", () => {
    const demo = { ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60" };
    expect(hasUnspecifiedCity(demo)).toBe(true);
    expect(var1MonthlyCells(demo, metrics)).toEqual([null, null, null, 40, 60, 100, null, null, null, null, null, null, 40, 60, 100]);
  });

  it("preserves an optional city subset through the normalized report payload without double counting", () => {
    const demo = demoFromPayload({ ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60" }, { thisCityMale: "15", thisCityFemale: "20" });
    expect(var1MonthlyCells(demo, metrics).slice(0, 6)).toEqual([15, 20, 35, 25, 40, 65]);
    expect(getDemographicTotals(demo).grandTotal).toBe(100);
    expect(hasUnspecifiedCity(demo)).toBe(false);
  });

  it("does not mark a province allocation complete when its optional city subset is invalid", () => {
    const demo = { ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60", thisCityMale: "41" };
    const status = getDemographicAllocationStatus(demo, 100);
    expect(status.isComplete).toBe(false);
    expect(status.validationMessage).toContain("optional city allocation");
  });
});
