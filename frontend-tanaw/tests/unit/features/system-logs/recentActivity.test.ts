import { describe, expect, it } from "vitest";
import {
  activityDetailFields,
  activityKind,
  activityLinks,
  activityReference,
  activityRequestId,
  activitySummaryParts,
  activityTitle,
  filterRecentActivity,
  paginateActivity,
  parseActivityType,
} from "../../../../src/features/system-logs/model/recentActivity";
import type { SystemLog } from "../../../../src/shared/types";

function log(overrides: Partial<SystemLog> & Pick<SystemLog, "id">): SystemLog {
  return {
    timestamp: "2026-11-23T06:00:00.000Z",
    group: "Login & Security",
    severity: "Info",
    actor: "Ana Reyes",
    actorRole: "Admin",
    action: "Login",
    target: "ana@example.com",
    summary: "Ana Reyes signed in to TANAW.",
    ...overrides,
  };
}

const november = { start: "2026-11-01", end: "2026-11-30" };

describe("Activity groups", () => {
  it("files every record under one of the six groups the Admin and IT share", () => {
    expect(activityKind(log({ id: "1", group: "Login & Security" }))).toBe("security");
    expect(activityKind(log({ id: "2", group: "Accounts" }))).toBe("accounts");
    expect(activityKind(log({ id: "3", group: "Reports" }))).toBe("reports");
    expect(activityKind(log({ id: "4", group: "Requests" }))).toBe("requests");
    expect(activityKind(log({ id: "5", group: "Monitoring" }))).toBe("monitoring");
    expect(activityKind(log({ id: "6", group: "Settings & Maintenance" }))).toBe("settings");
    expect(parseActivityType("monitoring")).toBe("monitoring");
    expect(parseActivityType("help")).toBe("all");
  });

  it("gives each action a plain, past-tense title", () => {
    expect(activityTitle(log({ id: "1", action: "Account Locked" }))).toBe("Account Locked");
    expect(activityTitle(log({ id: "2", action: "Camera Stopped Counting" }))).toBe("Camera Stopped Counting");
    expect(activityTitle(log({ id: "3", action: "Add Note for IT" }))).toBe("Note Added for IT");
    expect(activityTitle(log({ id: "4", action: "Final Report Finalized" }))).toBe("Consolidated Report Finalized");
  });
});

describe("Filtering and paging", () => {
  const records = [
    log({ id: "old", timestamp: "2026-10-30T06:00:00.000Z" }),
    log({ id: "camera", group: "Monitoring", action: "Camera Stopped Counting", summary: "The Gate A camera is not counting.", itDetail: "Error: connection refused", timestamp: "2026-11-20T06:00:00.000Z" }),
    log({ id: "login", timestamp: "2026-11-22T06:00:00.000Z" }),
  ];

  it("keeps records in range, newest first, with nothing pinned", () => {
    expect(filterRecentActivity(records, { type: "all", query: "", range: november }).map((record) => record.id)).toEqual(["login", "camera"]);
  });

  it("filters by group and searches the IT details too", () => {
    expect(filterRecentActivity(records, { type: "monitoring", query: "", range: november }).map((record) => record.id)).toEqual(["camera"]);
    expect(filterRecentActivity(records, { type: "all", query: "refused", range: november }).map((record) => record.id)).toEqual(["camera"]);
  });

  it("summarises the list without an unresolved count", () => {
    expect(activitySummaryParts(records.slice(1), "all", "")).toEqual({ label: "All activity", count: "2 records" });
  });

  it("pages eight records at a time", () => {
    const many = Array.from({ length: 10 }, (_, index) => log({ id: `log-${index}` }));
    expect(paginateActivity(many, 2)).toMatchObject({ page: 2, pageCount: 2, summary: "Showing 9–10 of 10" });
  });
});

describe("Activity details", () => {
  const request = log({
    id: "request-log",
    group: "Requests",
    action: "Send Request",
    sourceId: "request-1",
    target: "REQ-000142",
    metadata: { requestCode: "REQ-000142", requestGroup: "Desktop app or camera problem" },
  });

  it("links a Requests record to its request in each portal", () => {
    expect(activityRequestId(request)).toBe("request-1");
    expect(activityReference(request)).toBe("REQ-000142");
    expect(activityLinks(request, "admin")).toEqual([{ label: "Open the request", to: "/admin/requests?request=request-1" }]);
    expect(activityLinks(request, "it")[0].to).toBe("/it/work-center?view=requests&request=request-1");
    expect(activityDetailFields(request)).toEqual([
      { label: "Request", value: "REQ-000142" },
      { label: "Group", value: "Desktop app or camera problem" },
    ]);
  });

  it("names the place for Monitoring records and links to the Dashboard", () => {
    const camera = log({ id: "camera", group: "Monitoring", action: "Camera Stopped Counting", actor: "TANAW", actorRole: "System", target: "Sampaguita Gardens" });
    expect(activityDetailFields(camera)).toEqual([{ label: "Place", value: "Sampaguita Gardens" }]);
    expect(activityLinks(camera)).toEqual([{ label: "Open the Dashboard", to: "/admin/dashboard" }]);
  });
});
