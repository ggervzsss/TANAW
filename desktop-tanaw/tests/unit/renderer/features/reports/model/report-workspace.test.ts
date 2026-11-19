import { describe, expect, it } from "vitest";
import { buildLedgerRows, emptyDemo, validateDemographicAllocation, type PreparedReportCounts } from "../../../../../../src/features/reports/model/report-workspace";
import { dailyOriginsError, reportDays } from "../../../../../../src/features/reports/model/daily-origins";
import type { EstablishmentSummary } from "../../../../../../src/features/camera/services/establishment.types";
import type { DailyOrigins } from "../../../../../../src/types/enterprise";

const day = (business_date: string, unique_count: number, male_count: number) => ({
  business_date,
  covered_ms: 1000,
  qualified_observations: unique_count,
  identification_state: "available",
  unique_count,
  male_count,
  female_count: unique_count - male_count,
});
const origins = (otherCity: number): DailyOrigins[string] => ({
  otherCity: { male: otherCity, female: 0 },
  otherProvince: { male: 0, female: 1 },
  foreign: { male: 0, female: 0 },
});

function pendingRow(counts: PreparedReportCounts) {
  const rows = buildLedgerRows({
    currentDemo: emptyDemo(),
    currentOrigins: {},
    currentMetrics: { entries: null, exits: null, peak: null, unique: 0 },
    currentNotes: "",
    currentPeriod: "November 2026",
    pendingCounts: [counts],
    reportsHistory: [],
  });
  return rows.find((row) => row.kind === "pending");
}

describe("pending report rows", () => {
  const counting = { days: [day("2026-08-01", 10, 6), day("2026-08-02", 8, 4)] } as unknown as EstablishmentSummary;
  const counts = { period: "August 2026", reportId: "PENDING-2026-08", entries: 20, exits: 20, peakOccupancy: 5, uniqueCount: 18, counting };

  it("carry the origins confirmed in the month's draft, so the form is complete", () => {
    const row = pendingRow({ ...counts, origins: { "2026-08-01": origins(2), "2026-08-02": origins(1) } });
    const report = row?.report;

    expect(report?.origins?.["2026-08-01"]).toEqual(origins(2));
    expect(report?.demo).toMatchObject({ thisCityMale: "7", thisCityFemale: "6", thisProvMale: "10", otherProvFemale: "2" });
    const days = reportDays("August 2026", { entries: 20, exits: 20, peak: 5, unique: 18, counting }, report?.origins);
    expect(dailyOriginsError(days)).toBeNull();
    expect(validateDemographicAllocation({ entries: 20, exits: 20, peak: 5, unique: 18 }, report!.demo!)).toBeNull();
  });

  it("stay unallocated when the month has no draft", () => {
    const report = pendingRow(counts)?.report;

    expect(report?.origins).toBeUndefined();
    expect(report?.demo).toEqual(emptyDemo());
  });
});
