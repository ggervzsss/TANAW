import { describe, expect, it } from "vitest";
import {
  activityDetailFields,
  activityEmptyMessage,
  activityKind,
  activityLinks,
  activityReference,
  activityRequestId,
  activitySummaryParts,
  activityTitle,
  activityTypeOptions,
  filterRecentActivity,
  isBusyPlaceRecord,
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
  it("files every record under one of the seven groups the Admin and IT share", () => {
    expect(activityKind(log({ id: "1", group: "Login & Security" }))).toBe("security");
    expect(activityKind(log({ id: "2", group: "Accounts" }))).toBe("accounts");
    expect(activityKind(log({ id: "2e", group: "Enterprises" }))).toBe("enterprises");
    expect(activityKind(log({ id: "3", group: "Reports" }))).toBe("reports");
    expect(activityKind(log({ id: "4", group: "Requests" }))).toBe("requests");
    expect(activityKind(log({ id: "5", group: "Monitoring" }))).toBe("monitoring");
    expect(activityKind(log({ id: "6", group: "Settings & Maintenance" }))).toBe("settings");
    expect(parseActivityType("monitoring")).toBe("monitoring");
    expect(parseActivityType("enterprises")).toBe("enterprises");
    expect(parseActivityType("help")).toBe("all");
    expect(parseActivityType("busy")).toBe("busy");
    expect(parseActivityType(null)).toBe("all");
  });

  it("offers Busiest Enterprises right after Monitoring, with descriptions for the open menu only", () => {
    expect(activityTypeOptions.map((option) => option.label)).toEqual([
      "All Activity",
      "Login & Security",
      "Accounts",
      "Enterprises",
      "Reports",
      "Requests",
      "Monitoring",
      "Busiest Enterprises",
      "Settings & Maintenance",
    ]);
    expect(activityTypeOptions.find((option) => option.value === "busy")?.description).toBe("Places busier than usual right now");
    expect(activityTypeOptions.every((option) => !("meta" in option))).toBe(true);
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
    expect(activitySummaryParts([], "busy", "")).toEqual({ label: "Busiest Enterprises", count: "0 records" });
  });

  it("lists the busy-place Monitoring records under Busiest Enterprises", () => {
    const busy = log({ id: "busy", group: "Monitoring", actor: "TANAW", actorRole: "System", action: "Busier Than Usual", target: "San Antonio Plaza", timestamp: "2026-11-21T06:00:00.000Z" });
    const usual = log({ id: "usual", group: "Monitoring", actor: "TANAW", actorRole: "System", action: "Back to Usual", target: "San Antonio Plaza", timestamp: "2026-11-21T08:00:00.000Z" });
    const tagged = log({ id: "tagged", group: "Monitoring", action: "Place Alert", metadata: { alertType: "Busier Than Usual" }, timestamp: "2026-11-21T09:00:00.000Z" });
    const all = [...records, busy, usual, tagged];
    expect(isBusyPlaceRecord(busy)).toBe(true);
    expect(isBusyPlaceRecord(records[1])).toBe(false);
    expect(isBusyPlaceRecord(log({ id: "other-group", action: "Busier Than Usual" }))).toBe(false);
    expect(filterRecentActivity(all, { type: "busy", query: "", range: november }).map((record) => record.id)).toEqual(["tagged", "usual", "busy"]);
    expect(filterRecentActivity(all, { type: "monitoring", query: "", range: november }).map((record) => record.id)).toEqual(["tagged", "usual", "busy", "camera"]);
  });

  it("says what is missing when no record matches", () => {
    const range = { rangeText: "Nov 1 – 28, 2026" };
    expect(activityEmptyMessage({ type: "all", query: "", ...range })).toBe("No activity recorded for Nov 1 – 28, 2026.");
    expect(activityEmptyMessage({ type: "all", query: " plaza ", ...range })).toBe("No activity matching “plaza” for Nov 1 – 28, 2026.");
    expect(activityEmptyMessage({ type: "accounts", query: "", ...range })).toBe("No accounts for Nov 1 – 28, 2026.");
    expect(activityEmptyMessage({ type: "busy", query: "", noneBusyNow: true, ...range })).toBe("No place is busier than usual right now. No busy-place records for Nov 1 – 28, 2026.");
    expect(activityEmptyMessage({ type: "busy", query: "", noneBusyNow: false, ...range })).toBe("No busy-place records for Nov 1 – 28, 2026.");
    expect(activityEmptyMessage({ type: "busy", query: "plaza", noneBusyNow: true, ...range })).toBe("No busy-place records matching “plaza” for Nov 1 – 28, 2026.");
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
    expect(activityLinks(request, "it")[0].to).toBe("/it/requests?request=request-1");
    expect(activityDetailFields(request)).toEqual([
      { label: "Request", value: "REQ-000142" },
      { label: "Group", value: "Desktop app or camera problem" },
    ]);
  });

  it("names the place for Monitoring records and links to the Dashboard or Enterprises", () => {
    const camera = log({ id: "camera", group: "Monitoring", action: "Camera Stopped Counting", actor: "TANAW", actorRole: "System", target: "Sampaguita Gardens" });
    expect(activityDetailFields(camera)).toEqual([{ label: "Place", value: "Sampaguita Gardens" }]);
    expect(activityLinks(camera)).toEqual([{ label: "Open the Dashboard", to: "/admin/dashboard" }]);
    expect(activityLinks(camera, "it")).toEqual([{ label: "Open Enterprises", to: "/it/enterprises" }]);
  });

  it("files enterprise-account events under Enterprises and links to the enterprise in each portal", () => {
    const update = log({
      id: "enterprise",
      group: "Enterprises",
      action: "Update Enterprise Account",
      actor: "Ana Reyes",
      actorRole: "IT Personnel",
      target: "Laguna Lakeside Resort",
      metadata: { enterpriseId: "ENT-3", barangay: "Landayan" },
    });
    expect(activityTitle(update)).toBe("Enterprise Account Updated");
    expect(activityDetailFields(update)).toEqual([
      { label: "Enterprise", value: "Laguna Lakeside Resort" },
      { label: "Barangay", value: "Landayan" },
    ]);
    expect(activityLinks(update, "admin")).toEqual([{ label: "Open enterprise details", to: "/admin/enterprises/ENT-3" }]);
    expect(activityLinks(update, "it")).toEqual([{ label: "Open enterprise details", to: "/it/enterprises/ENT-3" }]);
    expect(filterRecentActivity([update], { type: "enterprises", query: "", range: november }).map((record) => record.id)).toEqual(["enterprise"]);
    expect(filterRecentActivity([update], { type: "accounts", query: "", range: november })).toEqual([]);
  });

  it("names the new request and password reset actions", () => {
    expect(activityTitle(log({ id: "start", action: "Start Request" }))).toBe("Request Started");
    expect(activityTitle(log({ id: "reset", action: "Send Password Reset" }))).toBe("Password Reset Email Sent");
  });
});
