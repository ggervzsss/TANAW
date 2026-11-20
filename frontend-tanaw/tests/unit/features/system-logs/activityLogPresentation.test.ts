import { describe, expect, it } from "vitest";
import { filterAdminActivityLogs, getAdminActivityMetrics } from "../../../../src/features/system-logs/model/activityLogPresentation";
import type { SystemLog } from "../../../../src/shared/types";

function record(id: string, day: number, resolutionStatus?: SystemLog["resolutionStatus"]): SystemLog {
  return {
    id,
    resolutionStatus,
    timestamp: new Date(Date.UTC(2026, 10, day)).toISOString(),
    category: "System",
    severity: "Warning",
    actor: "TANAW",
    actorRole: "System",
    action: "Alert Created",
    target: id,
    summary: "Technical issue",
  };
}

describe("Admin activity priority", () => {
  const older = record("Camera offline", 11, "Unresolved");
  const recent = record("Sync delayed", 14, "Unresolved");
  const ordinary = record("Report submitted", 18);
  const resolved = record("Recovered camera", 12, "Resolved");

  it("orders both groups by timestamp, returning each resolved update to its historical position", () => {
    expect(filterAdminActivityLogs([ordinary, older, resolved, recent], "", "All Activity", "All Time")).toEqual([recent, older, ordinary, resolved]);
    const recovered = { ...recent, resolutionStatus: "Resolved" } as const;
    expect(filterAdminActivityLogs([ordinary, older, resolved, recovered], "", "All Activity", "All Time")).toEqual([older, ordinary, recovered, resolved]);
  });

  it("applies text and category filters to both groups", () => {
    expect(filterAdminActivityLogs([ordinary, older, resolved, recent], "camera", "Issues & Resolutions", "All Time")).toEqual([older, resolved]);
    expect(filterAdminActivityLogs([older, resolved], "camera", "Reports", "All Time")).toEqual([]);
  });
  it("uses the same issue and security records for the Important Updates filter and summary", () => {
    const security = { ...record("Security event", 19), action: "Account locked" };
    const report = { ...record("Report submitted", 20), category: "Staff Submission" } as const;
    const records = [report, resolved, security, older];

    expect(filterAdminActivityLogs(records, "", "Important Updates", "All Time")).toEqual([older, security, resolved]);
    expect(getAdminActivityMetrics(records).importantCount).toBe(3);
  });
});
