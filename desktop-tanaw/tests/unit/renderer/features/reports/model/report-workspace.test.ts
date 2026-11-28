import { describe, expect, it } from "vitest";
import {
  applyCloudReview,
  buildLedgerRows,
  emptyDemo,
  localReportId,
  mergeReportHistory,
  reportFromCloudSubmission,
  reportFromLocalSubmission,
  reportSubmissionErrorMessage,
  reportSubmissionIssue,
  validateDemographicAllocation,
  validateReportDraft,
  type PreparedReportCounts,
} from "../../../../../../src/features/reports/model/report-workspace";
import type { EnterpriseIntakeReport } from "../../../../../../src/features/reports/services/report-history";
import { MlServiceRequestError } from "../../../../../../src/features/camera/services/ml-service.types";
import { dailyOriginsError, reportDays } from "../../../../../../src/features/reports/model/daily-origins";
import type { EstablishmentSummary } from "../../../../../../src/features/camera/services/establishment.types";
import type { DailyOrigins, ReportRecord } from "../../../../../../src/types/enterprise";

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

const ONE_REPORT_PER_MONTH = "A report for October 2026 has already been sent. If something is wrong, LGU Staff can return it to you for correction.";

describe("one report per month", () => {
  const submitted = { id: "REP-OCT", date: "October 2026", period: "October 2026", status: "Submitted", entries: 2, unique: 2 } as ReportRecord;

  it("refuses a second report for a month that already has one", () => {
    const options = { checkDuplicatePeriod: true, checkReportingPeriod: false };
    const metrics = { entries: 2, exits: 2, peak: 1, unique: 0 };
    expect(validateReportDraft(metrics, emptyDemo(), [], "October 2026", [submitted], null, options)).toBe(ONE_REPORT_PER_MONTH);
    expect(validateReportDraft(metrics, emptyDemo(), [], "November 2026", [submitted], null, options)).toBeNull();
    // A version reopened for correction gives the month back to its draft.
    expect(validateReportDraft(metrics, emptyDemo(), [], "October 2026", [{ ...submitted, reopenedAt: "2026-11-06T00:00:00Z" }], null, options)).toBeNull();
  });

  it("shows a report TANAW holds as submitted until it is consolidated", () => {
    const cloud = (status: EnterpriseIntakeReport["status"]) =>
      reportFromCloudSubmission(
        {
          id: "cloud",
          enterpriseId: "park",
          enterprise: "Park",
          category: "Parks",
          barangay: "Poblacion",
          month: "October",
          period: "October 2026",
          submitted: "2026-11-02T02:00:00Z",
          submittedAt: "2026-11-02T02:00:00Z",
          status,
          code: "REP-OCT",
          remarks: null,
          notes: null,
          metrics: { entry: 2, exit: 2, unique: 2, peak: 1 },
          payload: { status: "Resubmitted" },
        },
        "12-hour",
      ).status;
    expect([cloud("Pending Review"), cloud("Ready to Consolidate"), cloud("Consolidated"), cloud("Returned")]).toEqual(["Submitted", "Submitted", "Consolidated", "Returned"]);
  });
});

const intake = (changes: Partial<EnterpriseIntakeReport> = {}): EnterpriseIntakeReport => ({
  id: "cloud",
  enterpriseId: "park",
  enterprise: "Park",
  category: "Parks",
  barangay: "Poblacion",
  month: "October",
  period: "October 2026",
  submitted: "2026-11-02T02:00:00Z",
  submittedAt: "2026-11-02T02:00:00Z",
  status: "Pending Review",
  code: "REP-OCT",
  remarks: null,
  notes: null,
  metrics: { entry: 2, exit: 2, unique: 2, peak: 1 },
  ...changes,
});

describe("returned reports and their corrections", () => {
  it("carry TANAW's version, who returned them, when and why", () => {
    const returned = reportFromCloudSubmission(
      intake({ status: "Returned", version: 1, returnedReason: "Check the foreign visitors.", returnedBy: "Ana Cruz", returnedAt: "2026-11-05T02:00:00Z" }),
      "12-hour",
    );
    expect(returned).toMatchObject({ status: "Returned", reviewStatus: "Returned", version: 1, returnedReason: "Check the foreign visitors.", returnedBy: "Ana Cruz" });
    expect(returned.auditTrail?.at(-1)).toMatchObject({ action: "Returned for correction", actor: "Ana Cruz" });
    // Fields TANAW did not send stay off the record.
    expect("returnedReason" in reportFromCloudSubmission(intake(), "12-hour")).toBe(false);
    expect("version" in reportFromCloudSubmission(intake(), "12-hour")).toBe(false);
  });

  it("keep this computer's reopened state when TANAW's copy arrives", () => {
    const local = reportFromLocalSubmission(
      {
        report_id: "REP-OCT",
        submission_id: "s-1",
        period: "October 2026",
        submitted_at: "2026-11-02T02:00:00Z",
        entries: 2,
        exits: 2,
        peak_occupancy: 1,
        unique_count: 2,
        notes: null,
        payload: { status: "Submitted" },
        sync_status: "synced",
        synced_at: "2026-11-02T02:01:00Z",
        version: 1,
        reopened_at: "2026-11-06T00:00:00Z",
        reopen_reason: "returned",
        camera_breakdown: [],
      },
      "12-hour",
    );
    expect(local).toMatchObject({ status: "Returned", reviewStatus: "Returned", version: 1, reopenedAt: "2026-11-06T00:00:00Z" });
    const cloud = reportFromCloudSubmission(intake({ status: "Returned", version: 1, returnedReason: "Check the foreign visitors." }), "12-hour");
    const [merged] = mergeReportHistory([local], [cloud]);
    expect(merged).toMatchObject({ reopenedAt: "2026-11-06T00:00:00Z", returnedReason: "Check the foreign visitors.", status: "Returned" });
  });

  it("match a correction to TANAW's '-vN' code, keep this computer's id and show TANAW's code", () => {
    expect(localReportId("REP-FIX-v2", new Set(["REP-FIX"]))).toBe("REP-FIX");
    expect(localReportId("REP-FIX-v2", new Set(["REP-FIX-v2"]))).toBe("REP-FIX-v2");
    expect(localReportId("REP-OTHER-v2", new Set(["REP-FIX"]))).toBe("REP-OTHER-v2");
    const local = { id: "REP-FIX", date: "October 2026", period: "October 2026", status: "Submitted", entries: 2, unique: 2, syncStatus: "synced", version: 2, notes: "local" };
    const cloud = reportFromCloudSubmission(intake({ code: "REP-FIX-v2", version: 2, status: "Ready to Consolidate" }), "12-hour");
    const merged = mergeReportHistory([local], [cloud]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "REP-FIX", reference: "REP-FIX-v2", reviewStatus: "Ready to Consolidate", version: 2 });
    expect(applyCloudReview([local], [cloud])).toEqual([expect.objectContaining({ id: "REP-FIX", reference: "REP-FIX-v2" })]);
  });

  it("apply one month's review state from TANAW to the reports shown", () => {
    const shown = reportFromCloudSubmission(intake(), "12-hour");
    const accepted = reportFromCloudSubmission(intake({ status: "Ready to Consolidate", version: 1 }), "12-hour");
    const second = reportFromCloudSubmission(intake({ id: "cloud-2", code: "REP-OCT-2", version: 2, submittedAt: "2026-11-07T00:00:00Z" }), "12-hour");
    const applied = applyCloudReview([{ ...shown, notes: "kept" }], [accepted, second]);
    expect(applied.map((item) => item.id)).toEqual(["REP-OCT-2", "REP-OCT"]);
    expect(applied[1]).toMatchObject({ reviewStatus: "Ready to Consolidate", version: 1, notes: "kept" });
  });

  it("list the month's correction as its draft, ahead of the version it replaces", () => {
    const counting = { days: [day("2026-10-10", 2, 1)] } as unknown as EstablishmentSummary;
    const reopened = {
      ...reportFromCloudSubmission(intake({ status: "Returned", returnedReason: "Too many foreign visitors." }), "12-hour"),
      reopenedAt: "2026-11-06T00:00:00Z",
      origins: { "2026-10-10": origins(1) },
    };
    const rows = buildLedgerRows({
      currentDemo: emptyDemo(),
      currentOrigins: {},
      currentMetrics: { entries: null, exits: null, peak: null, unique: 0 },
      currentNotes: "",
      currentPeriod: "November 2026",
      pendingCounts: [{ period: "October 2026", reportId: "PENDING-2026-10", entries: 2, exits: 2, peakOccupancy: 1, uniqueCount: 2, counting }],
      reportsHistory: [reopened],
    });
    const october = rows.filter((row) => row.report.period === "October 2026");
    expect(october.map((row) => [row.kind, row.statusLabel])).toEqual([
      ["pending", "Being corrected"],
      ["history", "Returned"],
    ]);
    expect(october[0].report.origins).toEqual(reopened.origins);
    expect(october[1].reportDescription).toBe("Returned: Too many foreign visitors.");
  });
});

describe("report submission failures", () => {
  it("show the reason the local service rejected the report", () => {
    const conflict = new MlServiceRequestError("unknown", ONE_REPORT_PER_MONTH, 409);
    expect(reportSubmissionErrorMessage(conflict)).toBe(`Report not sent. ${ONE_REPORT_PER_MONTH}`);
    // Sending the same report again cannot fix it; the person changes something first.
    expect(reportSubmissionIssue(conflict).canRetry).toBe(false);
  });

  it("ask to try again when the service is unreachable or gave no reason", () => {
    const unavailable = reportSubmissionIssue(new MlServiceRequestError("service_unavailable", "The local ML service is unavailable."));
    expect(unavailable).toEqual({ message: "Report not sent. TANAW's counting service on this computer is not responding. Wait a moment, then try again.", canRetry: true });
    const generic = "Report not sent. Something went wrong on this computer. Try again.";
    expect(reportSubmissionErrorMessage(new MlServiceRequestError("unknown", "Request failed with status 422.", 422))).toBe(generic);
    expect(reportSubmissionErrorMessage(new MlServiceRequestError("unknown", "Internal Server Error", 500))).toBe(generic);
    expect(reportSubmissionErrorMessage(new Error("boom"))).toBe(generic);
  });
});
