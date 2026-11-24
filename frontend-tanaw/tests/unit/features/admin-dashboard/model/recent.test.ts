import { describe, expect, it } from "vitest";
import { activityTag, latestActivity, latestRequests, requestProgress } from "@/features/admin-dashboard/model/recent";
import { formatDayAndTime, formatRecentTime } from "@/features/admin-dashboard/model/time";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { PriorityAlert, SystemLog } from "@/shared/types";

function log(id: string, timestamp: string, overrides: Partial<SystemLog> = {}): SystemLog {
  return { id, timestamp, category: "Admin Operation", severity: "Info", actor: "LGU Admin", actorRole: "Admin", action: "Update Enterprise", target: "", summary: id, ...overrides };
}

describe("recent activity", () => {
  it("takes the newest three", () => {
    const logs = [log("a", "2026-11-20T08:00:00Z"), log("b", "2026-11-21T08:00:00Z"), log("c", "2026-11-19T08:00:00Z"), log("d", "2026-11-22T08:00:00Z")];
    expect(latestActivity(logs).map(({ id }) => id)).toEqual(["d", "b", "a"]);
  });

  it("tags activity in plain words", () => {
    expect(activityTag({ action: "Sign In", category: "Admin Operation", resolutionStatus: null })).toBe("Login");
    expect(activityTag({ action: "Update Support Ticket Status", category: "IT Activity", resolutionStatus: "Resolved" })).toBe("Resolved");
    expect(activityTag({ action: "Update Enterprise Details", category: "Admin Operation" })).toBe("Update");
    expect(activityTag({ action: "Submit Monthly Report", category: "Staff Submission" })).toBe("Report");
    expect(activityTag({ action: "Something else", category: "System" })).toBe("Activity");
  });

  it("formats times in Philippine time", () => {
    expect(formatDayAndTime("2026-11-21T10:16:00Z", "12-hour")).toBe("Nov 21, 6:16 PM");
    const now = new Date("2026-11-21T12:00:00Z");
    expect(formatRecentTime("2026-11-21T07:15:00Z", now, "12-hour")).toBe("3:15 PM");
    expect(formatRecentTime("2026-11-20T07:15:00Z", now, "12-hour")).toBe("Nov 20");
  });
});

describe("recent requests", () => {
  const alert = {
    id: "al-1",
    type: "Maintenance Request",
    severity: "Warning",
    urgency: "Normal",
    enterprise: "Public Market",
    requester: "Market",
    summary: "",
    requiredAction: "",
    resolutionMode: "Remote Review",
    status: "New",
    owner: "IT",
    time: "2026-11-21T07:15:00Z",
  } as PriorityAlert;
  const ticket = {
    id: "tk-1",
    subject: "Camera keeps disconnecting",
    enterpriseName: "Balon ni Lolo Uweng",
    status: "In Review",
    createdAt: "2026-11-20T01:00:00Z",
    updatedAt: "2026-11-21T05:40:00Z",
  } as SupportTicket;

  it("merges alerts and tickets, newest first, with deep links and progress", () => {
    expect(latestRequests([alert], [ticket])).toEqual([
      { key: "alert-al-1", title: "Maintenance request", place: "Public Market", time: alert.time, progress: "Seen by IT", search: "?alert=al-1" },
      { key: "ticket-tk-1", title: "Camera keeps disconnecting", place: "Balon ni Lolo Uweng", time: ticket.updatedAt, progress: "In progress", search: "?ticket=tk-1" },
    ]);
  });

  it("leaves out more-visitors-than-usual alerts, which the map shows", () => {
    const crowd = { ...alert, id: "al-crowd", type: "Foot Traffic Alert", owner: "Admin", time: "2026-11-21T09:00:00Z" } as PriorityAlert;
    const spike = { ...alert, id: "al-spike", type: "Occupancy Spike", owner: "Admin", time: "2026-11-21T09:30:00Z" } as PriorityAlert;
    expect(latestRequests([crowd, spike, alert], [ticket]).map((item) => item.key)).toEqual(["alert-al-1", "ticket-tk-1"]);
  });

  it("maps request statuses", () => {
    expect([requestProgress("New"), requestProgress("Open"), requestProgress("In Review"), requestProgress("Resolved")]).toEqual(["Seen by IT", "Seen by IT", "In progress", "Resolved"]);
  });
});
