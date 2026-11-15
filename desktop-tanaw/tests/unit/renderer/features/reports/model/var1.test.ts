import { describe, expect, it } from "vitest";
import { hasUnspecifiedCity, var1Days, var1MonthlyCells } from "../../../../../../src/features/reports/model/var1";
import { demoFromPayload, emptyDemo } from "../../../../../../src/features/reports/model/report-workspace";
import { getDemographicAllocationStatus, getDemographicTotals } from "../../../../../../src/features/reports/utils/demographics";
import { updateOriginValue } from "../../../../../../src/features/reports/model/demographic-allocation";
import type { Metrics } from "../../../../../../src/types/enterprise";

const metrics: Metrics = { entries: null, exits: null, peak: null, unique: 100 };
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
    expect(days.every((day) => day.total === null)).toBe(true);
  });
  it("keeps observed zero separate from missing daily records and never allocates monthly demographics over days", () => {
    const data = {
      ...metrics,
      counting: {
        days: [
          { business_date: "2026-05-01", covered_ms: 1000, qualified_observations: 0, identification_state: "available", unique_count: 0 },
          { business_date: "2026-05-02", covered_ms: 1000, qualified_observations: 4, identification_state: "available", unique_count: 4 },
          { business_date: "2026-05-03", covered_ms: 0, qualified_observations: 0, identification_state: "unavailable", unique_count: 0 },
        ],
      },
    } as Metrics;
    expect(
      var1Days("May 2026", data)
        .slice(0, 4)
        .map((day) => day.total),
    ).toEqual([0, 4, null, null]);
    expect(var1Days("May 2026", data)[0].weekday).toBe("Fri");
    expect(var1Days("Invalid month", data)).toEqual([]);
  });
  it("preserves province-only totals as unspecified rather than inventing a city split", () => {
    const demo = { ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60" };
    expect(hasUnspecifiedCity(demo)).toBe(true);
    expect(var1MonthlyCells(demo, metrics)).toEqual([null, null, null, 40, 60, 100, null, null, null, null, null, null, 40, 60, 100]);
    const next = updateOriginValue(demo, "city", "Male", "15", 100);
    expect(next.thisProvMale).toBe("40");
    expect(next.thisCityMale).toBe("15");
    expect(getDemographicTotals(next).grandTotal).toBe(100);
    expect(demo).not.toHaveProperty("thisCityMale");
  });
  it("preserves an optional city subset through the existing normalized report payload without double counting", () => {
    const demo = demoFromPayload({ ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60" }, { thisCityMale: "15", thisCityFemale: "20" });
    expect(var1MonthlyCells(demo, metrics).slice(0, 6)).toEqual([15, 20, 35, 25, 40, 65]);
    expect(getDemographicTotals(demo).grandTotal).toBe(100);
    expect(hasUnspecifiedCity(demo)).toBe(false);
  });
  it("retains the existing whole-number cap when editing the four Figma residence rows", () => {
    let demo = updateOriginValue(emptyDemo(), "city", "Male", "70", 100);
    demo = updateOriginValue(demo, "otherCity", "Female", "50", 100);
    expect(demo.thisProvFemale).toBe("30");
    expect(getDemographicTotals(demo).grandTotal).toBe(100);
    demo = updateOriginValue(demo, "foreign", "Female", "-5", 100);
    expect(demo.foreignFemale).toBe("");
    expect(getDemographicTotals(demo).grandTotal).toBe(100);
  });
  it("does not mark a province allocation complete when its optional city subset is invalid", () => {
    const demo = { ...emptyDemo(), thisProvMale: "40", thisProvFemale: "60", thisCityMale: "41" };
    const status = getDemographicAllocationStatus(demo, 100);
    expect(status.isComplete).toBe(false);
    expect(status.validationMessage).toContain("optional city allocation");
  });
});
