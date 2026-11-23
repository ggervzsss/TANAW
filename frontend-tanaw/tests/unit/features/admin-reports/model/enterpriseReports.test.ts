import { describe, expect, it } from "vitest";
import type { AccountSummary, FinalReport, IntakeReport, MapEnterprise, ReportEnterprise, SystemLog } from "@/shared/types";
import {
  buildEnterpriseProfiles,
  buildMonthEntry,
  buildReportRows,
  cameraSummary,
  filterReportRows,
  historyMonths,
  historyYears,
  indexReports,
  missingNote,
  needsAllMonths,
  pendingNote,
  reviewersByReport,
  summarizeYear,
  yearOptionNote,
} from "../../../../../src/features/admin-reports/model/enterpriseReports";
import { periodLabel, type MonthKey } from "../../../../../src/features/admin-reports/model/reportMonths";

// Today is Tuesday, Nov 24, 2026: October reports were due Nov 10, November reports are due Dec 10.
const today = new Date(2026, 10, 24, 9, 0);

function enterprise(id: string, name: string): ReportEnterprise {
  return { id, name, category: "Public Market", barangay: "Poblacion", complianceOwner: "Operator" };
}

function report(enterpriseId: string, month: string, year: number, overrides: Partial<IntakeReport> = {}): IntakeReport {
  return {
    id: `${enterpriseId}-${month}-${year}`,
    enterpriseId,
    enterprise: enterpriseId,
    category: "Public Market",
    attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
    barangay: "Poblacion",
    month,
    period: `${month} ${year}`,
    submitted: "",
    submittedAt: `${year}-${String(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(month) + 2).padStart(2, "0")}-03T09:00:00`,
    status: "Pending Review",
    code: `RPT-${enterpriseId}-${month}`,
    metrics: { entry: null, exit: null, unique: 10, peak: null },
    ...overrides,
  };
}

function account(enterpriseId: string, createdAt: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: `account-${enterpriseId}`,
    email: `${enterpriseId}@example.test`,
    phone: "0917 555 0101",
    firstName: "Edwin",
    lastName: "Ramos",
    enterpriseName: enterpriseId,
    category: "Public Market",
    managerName: "Edwin Ramos",
    barangay: "Poblacion",
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId,
    gatewayStatus: null,
    buildingCapacity: 100,
    displayName: enterpriseId,
    role: "enterprise",
    title: "Enterprise",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt,
    lastLoginAt: null,
    ...overrides,
  };
}

function mapEntry(id: string, configured: number, healthy: number): MapEnterprise {
  return {
    id,
    name: id,
    barangay: "Poblacion",
    category: "Public Market",
    fullAddress: "",
    lat: 0,
    lng: 0,
    totalLiveOccupancy: null,
    estimatedUniqueCount: null,
    monitoringStatus: "Fully Monitoring",
    occupancyStatus: "Normal",
    cameraMonitoring: { status: "running", configuredCameraCount: configured, activeCameraCount: healthy, healthyCameraCount: healthy, startingCameraCount: 0, stoppedCameraCount: 0, errorCameraCount: 0 },
  };
}

const october: MonthKey = { year: 2026, monthIndex: 9 };

describe("cameraSummary", () => {
  it("says how many cameras are set up and monitoring", () => {
    expect(cameraSummary(mapEntry("a", 6, 6))).toBe("6, all monitoring");
    expect(cameraSummary(mapEntry("a", 6, 4))).toBe("6, 4 monitoring");
    expect(cameraSummary(mapEntry("a", 2, 0))).toBe("2, none monitoring");
    expect(cameraSummary(mapEntry("a", 0, 0))).toBe("None set up");
    expect(cameraSummary(undefined)).toBeNull();
  });
});

describe("buildEnterpriseProfiles", () => {
  it("joins contact, registration and camera details by enterprise ID", () => {
    const [profile] = buildEnterpriseProfiles([enterprise("market", "Public Market")], [account("market", "2025-01-15T08:00:00")], [mapEntry("market", 6, 6)], []);
    expect(profile).toMatchObject({ contactPerson: "Edwin Ramos", email: "market@example.test", phone: "0917 555 0101", cameras: "6, all monitoring", firstMonth: { year: 2025, monthIndex: 0 } });
    expect(profile.registeredAt?.getFullYear()).toBe(2025);
  });

  it("starts the history at an earlier month the enterprise already reported", () => {
    const [profile] = buildEnterpriseProfiles([enterprise("market", "Public Market")], [account("market", "2026-06-01T08:00:00")], [], [report("market", "March", 2026)]);
    expect(profile.firstMonth).toEqual({ year: 2026, monthIndex: 2 });
  });

  it("leaves details empty when the account and map entries are missing", () => {
    const [profile] = buildEnterpriseProfiles([enterprise("market", "Public Market")], [], [], []);
    expect(profile).toMatchObject({ contactPerson: null, email: null, phone: null, cameras: null, registeredAt: null, firstMonth: null });
  });
});

describe("buildReportRows", () => {
  const profiles = buildEnterpriseProfiles(
    [enterprise("sent", "Bayside Park"), enterprise("late", "Aplaya Resort"), enterprise("new", "Newly Registered"), enterprise("old", "Cuyab Museum")],
    [account("sent", "2025-01-01T08:00:00"), account("late", "2025-01-01T08:00:00"), account("new", "2026-11-02T08:00:00"), account("old", "2025-01-01T08:00:00")],
    [],
    [],
  );
  const reports = indexReports([
    report("sent", "October", 2026, { status: "Ready to Consolidate" }),
    report("old", "September", 2026),
  ]);
  const reviewers = reviewersByReport(
    [{ id: "log-1", timestamp: "2026-11-12T10:00:00", category: "Staff Operation", severity: "Success", actor: "Maria Santos", actorRole: "LGU Staff", action: "Report Ready to Consolidate", target: "Bayside Park", summary: "", sourceId: "sent-October-2026" }],
    [],
  );

  it("leaves out enterprises registered after the month and sorts Missing, Pending, Submitted", () => {
    const rows = buildReportRows(profiles, reports, reviewers, october, today);
    expect(rows.map((row) => [row.enterprise.name, row.entry.submission])).toEqual([
      ["Aplaya Resort", "Missing"],
      ["Cuyab Museum", "Missing"],
      ["Bayside Park", "Submitted"],
    ]);
    expect(rows[2].entry).toMatchObject({ reportCode: "RPT-sent-October", review: "Consolidated", reviewedBy: "Maria Santos" });
    expect(rows[0].entry.submissionNote).toBe("14 days overdue");
  });

  it("shows this month's enterprises as Pending before the due date", () => {
    const rows = buildReportRows(profiles, reports, reviewers, { year: 2026, monthIndex: 10 }, today);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.entry.submission === "Pending")).toBe(true);
    expect(rows[0].entry.submissionNote).toBe("Due Dec 10");
  });

  it("filters by search, enterprise and submission status", () => {
    const rows = buildReportRows(profiles, reports, reviewers, october, today);
    expect(filterReportRows(rows, { query: "maria", enterpriseId: "all", submission: "all" }).map((row) => row.enterprise.id)).toEqual(["sent"]);
    expect(filterReportRows(rows, { query: "rpt-sent", enterpriseId: "all", submission: "all" })).toHaveLength(1);
    expect(filterReportRows(rows, { query: "", enterpriseId: "late", submission: "all" }).map((row) => row.enterprise.id)).toEqual(["late"]);
    expect(filterReportRows(rows, { query: "", enterpriseId: "all", submission: "Missing" })).toHaveLength(2);
    expect(filterReportRows(rows, { query: "", enterpriseId: "all", submission: "Pending" })).toHaveLength(0);
  });
});

describe("reviewersByReport", () => {
  const finalReport = { id: "FR-2026-10", generatedOn: "2026-11-20", preparedBy: "Jose Cruz", sources: [{ id: "r1" }, { id: "r2" }] } as unknown as FinalReport;
  const log = (sourceId: string, actor: string, action: string, timestamp: string): SystemLog => ({
    id: `${sourceId}-${timestamp}`,
    timestamp,
    category: "Staff Operation",
    severity: "Success",
    actor,
    actorRole: "LGU Staff",
    action,
    target: "",
    summary: "",
    sourceId,
  });

  it("prefers the latest logged review decision over the city summary's preparer", () => {
    const reviewers = reviewersByReport(
      [log("r1", "Ana Reyes", "Report Returned", "2026-11-11T09:00:00"), log("r1", "Maria Santos", "Report Ready to Consolidate", "2026-11-14T09:00:00"), log("r3", "Ana Reyes", "Submit Enterprise Report", "2026-11-02T09:00:00")],
      [finalReport],
    );
    expect(reviewers.get("r1")).toBe("Maria Santos");
    expect(reviewers.get("r2")).toBe("Jose Cruz");
    expect(reviewers.has("r3")).toBe(false);
  });
});

describe("report history", () => {
  const profile = { firstMonth: { year: 2025, monthIndex: 3 } };

  it("lists the years since registration, newest first", () => {
    expect(historyYears(profile, today)).toEqual([2026, 2025]);
    expect(historyYears({ firstMonth: null }, today)).toEqual([2026]);
  });

  it("lists a year's months from registration to this month, newest first", () => {
    expect(historyMonths(profile, 2025, today).map(periodLabel)).toEqual(["December 2025", "November 2025", "October 2025", "September 2025", "August 2025", "July 2025", "June 2025", "May 2025", "April 2025"]);
    const thisYear = historyMonths(profile, 2026, today);
    expect(thisYear).toHaveLength(11);
    expect(periodLabel(thisYear[0])).toBe("November 2026");
  });

  it("summarizes a year with submitted, pending and missing months", () => {
    const reports = indexReports(["January", "February", "March", "April", "May", "June", "August", "September", "October"].map((month) => report("market", month, 2026)));
    const entries = historyMonths({ firstMonth: { year: 2025, monthIndex: 0 } }, 2026, today).map((month) => buildMonthEntry("market", month, reports, new Map(), today));
    const summary = summarizeYear(2026, entries);
    expect(summary.submitted).toBe(9);
    expect(summary.due).toBe(10);
    expect(yearOptionNote(summary)).toBe("9 of 10 submitted");
    expect(pendingNote(summary)).toBe("November, due Dec 10");
    expect(missingNote(summary)).toBe("July");
    const empty = summarizeYear(2025, []);
    expect(pendingNote(empty)).toBe("None in 2025");
    expect(missingNote(empty)).toBe("None in 2025");
    expect(yearOptionNote(empty)).toBe("None due yet");
  });

  it("shows every month when the opened month is beyond the first six", () => {
    const months = historyMonths(profile, 2026, today);
    expect(needsAllMonths(months, october)).toBe(false);
    expect(needsAllMonths(months, { year: 2026, monthIndex: 3 })).toBe(true);
    expect(needsAllMonths(months, null)).toBe(false);
  });
});
