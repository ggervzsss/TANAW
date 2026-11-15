import { describe, expect, it } from "vitest";
import { REPORTS_MOCK_DATA, SAMPLE_REPORT_PREVIEWS, sampleMetrics } from "../../../../../../src/features/reports/data/reportsMockData";
import { DASHBOARD_MOCK_DATA } from "../../../../../../src/features/dashboard/data/dashboardMockData";
import { getDemographicTotals } from "../../../../../../src/features/reports/utils/demographics";
import { var1DailyCells, var1Days } from "../../../../../../src/features/reports/model/var1";

describe("isolated Reports samples", () => {
  it("reconciles every daily residence and gender allocation to its monthly total", () => {
    for (const record of [REPORTS_MOCK_DATA.current, ...REPORTS_MOCK_DATA.reports]) {
      const days = var1Days(record.period!, sampleMetrics(record));
      expect(record.daily).toHaveLength(days.length);
      const sum = Array<number>(15).fill(0);
      days.forEach((day) => var1DailyCells(day, record.daily).forEach((value, index) => (sum[index] += value ?? 0)));
      expect(sum[14]).toBe(record.unique);
      expect(sum[12] + sum[13]).toBe(record.unique);
      expect(sum[2] + sum[5] + sum[8] + sum[11]).toBe(record.unique);
      expect(getDemographicTotals(record.demo).grandTotal).toBe(record.unique);
      expect(record.id).toMatch(/^MOCK-/);
      expect(record.kind).toBe("reports-sample");
      expect(record).not.toHaveProperty("counting");
    }
  });
  it("uses the same sample identities and statuses in both Reports and Dashboard", () => {
    expect(DASHBOARD_MOCK_DATA.reports).toBe(SAMPLE_REPORT_PREVIEWS);
    expect(SAMPLE_REPORT_PREVIEWS.map((record) => [record.id, record.status, record.period])).toEqual(REPORTS_MOCK_DATA.reports.map((record) => [record.id, record.status, record.period]));
  });
});
