import { describe, expect, it } from "vitest";
import {
  activityDetailFields,
  activityKind,
  activityLinks,
  activityPageOf,
  activityReference,
  activityRequest,
  activitySummaryParts,
  activityTitle,
  filterRecentActivity,
  formatActivityDate,
  formatActivityTime,
  isPinnedActivity,
  openDurationLabel,
  paginateActivity,
  parseActivityType,
  philippineDay,
  reportMonthParams,
} from "../../../../src/features/system-logs/model/recentActivity";
import type { SystemLog } from "../../../../src/shared/types";

function log(overrides: Partial<SystemLog> & Pick<SystemLog, "id">): SystemLog {
  return {
    timestamp: "2026-11-20T02:00:00Z",
    category: "Admin Operation",
    severity: "Info",
    actor: "LGU Admin",
    actorRole: "Admin",
    action: "Login",
    target: "admin@example.test",
    summary: "LGU Admin signed in to TANAW.",
    ...overrides,
  };
}

const november = { start: "2026-11-01", end: "2026-11-23" };

describe("activity types", () => {
  it.each<[string, Partial<SystemLog>, ReturnType<typeof activityKind>]>([
    ["sign-in", { action: "Login" }, "security"],
    ["sign-out", { action: "Logout", category: "Staff Operation" }, "security"],
    ["password recovery", { action: "Password Recovery Request", category: "System", severity: "Warning" }, "security"],
    ["a System warning", { action: "Something Odd", category: "System", severity: "Warning" }, "security"],
    ["report submission", { action: "Submit Enterprise Report", category: "Staff Submission" }, "reports"],
    ["staff review", { action: "Report Returned", category: "Staff Operation" }, "reports"],
    ["consolidated report", { action: "Final Report Finalized", category: "Staff Operation" }, "reports"],
    ["account created", { action: "Create Enterprise Account", category: "IT Activity" }, "accounts"],
    ["password change", { action: "Password Changed", category: "Staff Operation" }, "accounts"],
    ["profile change decision", { action: "Approve Enterprise Profile Change", category: "IT Activity" }, "accounts"],
    ["support ticket", { action: "Submit Important Support Request", category: "Enterprise Activity" }, "help"],
    ["ticket status change", { action: "Update Support Ticket Status", category: "IT Activity" }, "help"],
    ["operational alert", { action: "Alert Created", category: "Admin Operation", actorRole: "System" }, "help"],
    ["desktop app problem", { action: "Desktop Application Problem", category: "Enterprise Activity" }, "help"],
    ["any tracked issue", { action: "Unknown Issue", resolutionStatus: "Resolved" }, "help"],
    ["a message to an enterprise", { action: "Notify Enterprise", category: "Staff Operation" }, "actions"],
    ["a settings change", { action: "Update System Settings", category: "IT Activity" }, "actions"],
  ])("files %s under its type", (_name, overrides, kind) => {
    expect(activityKind(log({ id: "a", ...overrides }))).toBe(kind);
  });

  it("reads an unknown type filter as all activity", () => {
    expect(parseActivityType("help")).toBe("help");
    expect(parseActivityType("bogus")).toBe("all");
    expect(parseActivityType(null)).toBe("all");
  });

  it("gives logged actions readable titles", () => {
    expect(activityTitle(log({ id: "a", action: "Login" }))).toBe("Signed In");
    expect(activityTitle(log({ id: "a", action: "Alert Created", metadata: { alertType: "Foot Traffic Alert" } }))).toBe("Busy Establishment Alert Raised");
    expect(activityTitle(log({ id: "a", action: "Alert Resolved", metadata: { alertType: "Unknown" } }))).toBe("Alert Resolved");
    expect(activityTitle(log({ id: "a", action: "Final Report Archived" }))).toBe("Consolidated Report Archived");
    expect(activityTitle(log({ id: "a", action: "Brand New Action" }))).toBe("Brand New Action");
  });
});

describe("pinning, filtering and ordering", () => {
  const pinnedOld = log({
    id: "pinned-old",
    timestamp: "2026-09-02T02:00:00Z",
    action: "Desktop Application Problem",
    category: "Enterprise Activity",
    actor: "Casa San Pedro",
    actorRole: "Enterprise Account",
    resolutionStatus: "Unresolved",
    summary: "Camera stopped.",
  });
  const resolvedTicket = log({
    id: "resolved",
    timestamp: "2026-11-05T02:00:00Z",
    action: "Submit Support Ticket",
    category: "Enterprise Activity",
    resolutionStatus: "Resolved",
    summary: "Sync request.",
  });
  const signIn = log({ id: "sign-in", timestamp: "2026-11-21T02:00:00Z" });
  const report = log({
    id: "report",
    timestamp: "2026-11-22T02:00:00Z",
    action: "Submit Enterprise Report",
    category: "Staff Submission",
    actor: "Pacita Complex Mall",
    actorRole: "Enterprise Account",
    summary: "Pacita Complex Mall submitted RPT-1.",
  });
  const october = log({ id: "october", timestamp: "2026-10-30T02:00:00Z" });
  const logs = [october, signIn, resolvedTicket, report, pinnedOld];

  it("pins only unresolved records", () => {
    expect(isPinnedActivity(pinnedOld)).toBe(true);
    expect(isPinnedActivity(resolvedTicket)).toBe(false);
    expect(isPinnedActivity(signIn)).toBe(false);
  });

  it("puts pinned records first, then newest first, and keeps pinned records outside the range", () => {
    expect(filterRecentActivity(logs, { type: "all", query: "", range: november }).map((item) => item.id)).toEqual(["pinned-old", "report", "sign-in", "resolved"]);
  });

  it("filters by type and search, and the search covers title, person and details", () => {
    expect(filterRecentActivity(logs, { type: "help", query: "", range: november }).map((item) => item.id)).toEqual(["pinned-old", "resolved"]);
    expect(filterRecentActivity(logs, { type: "all", query: "pacita", range: november }).map((item) => item.id)).toEqual(["report"]);
    expect(filterRecentActivity(logs, { type: "all", query: "signed in", range: november }).map((item) => item.id)).toEqual(["sign-in"]);
    expect(filterRecentActivity(logs, { type: "reports", query: "camera", range: november })).toEqual([]);
  });

  it("uses the Philippine calendar day for the date range", () => {
    // 16:30 UTC on Oct 31 is already Nov 1 in Manila.
    const lateNight = log({ id: "late", timestamp: "2026-10-31T16:30:00Z" });
    expect(philippineDay(lateNight.timestamp)).toBe("2026-11-01");
    expect(filterRecentActivity([lateNight], { type: "all", query: "", range: november })).toHaveLength(1);
    expect(filterRecentActivity([lateNight], { type: "all", query: "", range: { start: "2026-10-01", end: "2026-10-31" } })).toHaveLength(0);
  });

  it("summarises the list", () => {
    const shown = filterRecentActivity(logs, { type: "all", query: "", range: november });
    expect(activitySummaryParts(shown, "all", "")).toEqual({ label: "All activity", count: "4 records", pinned: "1 unresolved pinned" });
    expect(activitySummaryParts(shown.slice(0, 1), "help", "camera")).toEqual({ label: "Help Requests", count: "1 matching record", pinned: "1 unresolved pinned" });
  });
});

describe("paging", () => {
  const items = Array.from({ length: 19 }, (_, index) => index);

  it("shows eight per page with a summary", () => {
    expect(paginateActivity(items, 1)).toMatchObject({ page: 1, pageCount: 3, rows: [0, 1, 2, 3, 4, 5, 6, 7], summary: "Showing 1–8 of 19" });
    expect(paginateActivity(items, 3)).toMatchObject({ page: 3, rows: [16, 17, 18], summary: "Showing 17–19 of 19" });
  });

  it("clamps the page and handles an empty list", () => {
    expect(paginateActivity(items, 9).page).toBe(3);
    expect(paginateActivity(items, 0).page).toBe(1);
    expect(paginateActivity([], 2)).toMatchObject({ page: 1, pageCount: 1, rows: [], summary: "Showing 0 of 0" });
  });

  it("finds the page that holds an item", () => {
    expect(activityPageOf(-1)).toBe(1);
    expect(activityPageOf(7)).toBe(1);
    expect(activityPageOf(8)).toBe(2);
  });
});

describe("drawer details", () => {
  it("formats dates and times in Philippine time", () => {
    expect(formatActivityDate("2026-11-23T07:15:00Z")).toBe("Nov 23, 2026");
    expect(formatActivityTime("2026-11-23T07:15:00Z", "12-hour")).toBe("3:15 PM");
    expect(formatActivityTime("2026-11-23T07:15:00Z", "24-hour")).toBe("15:15");
  });

  it("says how long an unresolved record has been open", () => {
    const now = new Date("2026-11-23T08:00:00Z");
    expect(openDurationLabel("2026-11-23T02:00:00Z", now)).toBe("less than a day");
    expect(openDurationLabel("2026-11-22T02:00:00Z", now)).toBe("1 day");
    expect(openDurationLabel("2026-11-20T02:00:00Z", now)).toBe("3 days");
  });

  it("links support tickets and alerts to the Requests page, stripping sample prefixes", () => {
    const ticket = log({
      id: "t",
      action: "Submit Important Support Request",
      target: "TCK-0042",
      sourceId: "sample:activity:ticket:ticket-9",
      resolutionStatus: "Unresolved",
      metadata: { enterpriseId: "ENT-7" },
    });
    expect(activityRequest(ticket)).toEqual({ kind: "ticket", id: "ticket-9" });
    expect(activityReference(ticket)).toBe("TCK-0042");
    expect(activityLinks(ticket)).toEqual([
      { label: "View details", to: "/admin/requests?ticket=ticket-9" },
      { label: "Open enterprise details", to: "/admin/enterprises/ENT-7" },
    ]);
    const alert = log({ id: "0f3b2c1d-aaaa", action: "Desktop Application Problem", sourceId: "alert-5" });
    expect(activityLinks(alert)[0]).toEqual({ label: "View details", to: "/admin/requests?alert=alert-5" });
    expect(activityReference(alert)).toBe("ACT-0F3B2C1D");
  });

  it("links reports to Enterprise Reports for the report month and enterprise", () => {
    expect(reportMonthParams("October 2026")).toEqual({ month: "October", year: "2026" });
    expect(reportMonthParams("2026-10")).toBeNull();
    const submitted = log({
      id: "r",
      action: "Submit Enterprise Report",
      category: "Staff Submission",
      target: "Casa San Pedro",
      metadata: { enterpriseId: "ENT-1", period: "October 2026", uniqueCount: 1250 },
    });
    expect(activityLinks(submitted)).toEqual([
      { label: "Open Enterprise Reports", to: "/admin/reports?enterprise=ENT-1&month=October&year=2026" },
      { label: "Open enterprise details", to: "/admin/enterprises/ENT-1" },
    ]);
    expect(activityDetailFields(submitted)).toEqual([
      { label: "Enterprise", value: "Casa San Pedro" },
      { label: "Period", value: "October 2026" },
      { label: "Submission", value: "Submitted", tone: "submitted" },
      { label: "Unique visitors", value: "1,250" },
    ]);
  });

  it("shows staff review and request progress as status pills", () => {
    const returned = log({ id: "r", action: "Report Returned", category: "Staff Operation", target: "Casa San Pedro", metadata: { period: "October 2026", remarks: "Fix origins" } });
    expect(activityDetailFields(returned)).toContainEqual({ label: "Staff review", value: "Reviewing", tone: "reviewing" });
    expect(activityDetailFields(returned)).toContainEqual({ label: "Remarks", value: "Fix origins" });
    const open = log({
      id: "h",
      action: "Desktop Application Problem",
      actor: "Casa San Pedro",
      actorRole: "Enterprise Account",
      resolutionStatus: "Unresolved",
      metadata: { status: "New", cameraName: "Gate" },
    });
    expect(activityDetailFields(open)).toEqual([
      { label: "Type", value: "Desktop app problem" },
      { label: "Location", value: "Casa San Pedro" },
      { label: "Camera", value: "Gate" },
      { label: "Progress", value: "Not resolved yet", tone: "pending" },
      { label: "Status when recorded", value: "Open", tone: "pending" },
    ]);
    const update = log({ id: "u", action: "Update Support Ticket Status", target: "TCK-1", sourceId: "ticket-1", metadata: { status: "In Review" } });
    expect(activityDetailFields(update)).toContainEqual({ label: "Changed to", value: "In progress", tone: "reviewing" });
  });

  it("describes account changes and other actions from the log alone", () => {
    const decision = log({
      id: "d",
      action: "Decline Enterprise Profile Change",
      target: "Casa San Pedro",
      metadata: { requestType: "Contact number", previousValue: "0917", requestedValue: "0918", resolution: "decline" },
    });
    expect(activityDetailFields(decision)).toEqual([
      { label: "Account", value: "Casa San Pedro" },
      { label: "Change requested", value: "Contact number" },
      { label: "Change", value: "0917 → 0918" },
      { label: "Decision", value: "Declined" },
    ]);
    expect(activityLinks(decision)).toEqual([{ label: "Open Requests", to: "/admin/requests" }]);
    const signIn = log({ id: "s" });
    expect(activityDetailFields(signIn)).toEqual([
      { label: "Account", value: "LGU Admin, Administrator" },
      { label: "Affected item", value: "admin@example.test" },
    ]);
    expect(activityLinks(signIn)).toEqual([]);
  });
});
