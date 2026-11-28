import { describe, expect, it } from "vitest";
import {
  categoryFilterOptions,
  countUnread,
  filterRequests,
  findLinkedRequest,
  groupRequestsByDay,
  hasActiveFilters,
  initialRequestFilters,
  isRequestFilters,
  progressFilterOptions,
  requestCategory,
  requestMarker,
  requestPlace,
  requestProgress,
  requestProgressState,
  unreadLabel,
} from "../../../../../src/features/alerts-monitor/model/adminRequests";
import { request } from "../../../fixtures/requests";

const now = new Date("2026-11-23T08:00:00Z");
const CARLO = { accountId: "it-1", name: "Carlo Mendoza" };

describe("Admin Requests list", () => {
  const requests = [
    request({ id: "camera", camera: "Gate A", handledBy: CARLO, createdAt: "2026-11-23T06:00:00Z", unread: true }),
    request({ id: "help", group: "Sign-in help", title: "Sign-in help", enterpriseName: null, enterpriseId: null, requesterName: "Joy Villanueva", seenByIt: true, createdAt: "2026-11-22T06:00:00Z", updated: true }),
    request({ id: "change", group: "Account change", title: "Change of contact number", status: "Approved", createdAt: "2026-11-20T06:00:00Z" }),
    request({ id: "app", title: "The desktop app will not open", createdAt: "2026-11-19T06:00:00Z" }),
    request({ id: "report", group: "Report problem", title: "The October report will not upload", status: "Resolved", seenByIt: true, createdAt: "2026-11-18T06:00:00Z" }),
  ];

  it("filters by type, progress and search, newest first", () => {
    const ids = (filters: Partial<typeof initialRequestFilters>) => filterRequests(requests, { ...initialRequestFilters, ...filters }).map((item) => item.id);
    expect(ids({})).toEqual(["camera", "help", "change", "app", "report"]);
    expect(ids({ category: "Account and Access" })).toEqual(["help", "change"]);
    expect(ids({ category: "Camera Issue" })).toEqual(["camera"]);
    expect(ids({ category: "Desktop app and Maintenance" })).toEqual(["app"]);
    expect(ids({ progress: "Resolved" })).toEqual(["change", "report"]);
    expect(ids({ progress: "In Progress" })).toEqual(["camera"]);
    expect(ids({ progress: "Seen by IT" })).toEqual(["help"]);
    expect(ids({ query: "joy" })).toEqual(["help"]);
    // The search reads the type the Admin sees, not the group IT files it under.
    expect(ids({ query: "maintenance" })).toEqual(["app"]);
  });

  it("puts each request group under the Admin's types", () => {
    expect(requestCategory({ group: "Desktop app or camera problem", camera: "Gate A" })).toBe("Camera Issue");
    expect(requestCategory({ group: "Desktop app or camera problem", camera: null })).toBe("Desktop app and Maintenance");
    expect(requestCategory({ group: "Desktop app or camera problem", camera: "  " })).toBe("Desktop app and Maintenance");
    expect(requestCategory({ group: "Report problem", camera: null })).toBe("Report Concern");
    expect(requestCategory({ group: "Sign-in help" })).toBe("Account and Access");
    expect(requestCategory({ group: "Account change" })).toBe("Account and Access");
    expect(requestCategory({ group: "Other", camera: "Gate A" })).toBe("Others");
  });

  it("works out how far IT has got", () => {
    expect(requestProgress({ status: "Approved", handledBy: null, seenByIt: false })).toBe("Resolved");
    expect(requestProgress({ status: "Resolved", handledBy: CARLO, seenByIt: true })).toBe("Resolved");
    expect(requestProgress({ status: "In Progress", handledBy: CARLO, seenByIt: true })).toBe("In Progress");
    expect(requestProgress({ status: "In Progress", handledBy: null, seenByIt: true })).toBe("Seen by IT");
    // Nobody in IT has opened it: no Progress option matches, and the row says so.
    expect(requestProgress({ status: "In Progress", handledBy: null, seenByIt: false })).toBeNull();
    expect(requestProgressState({ status: "In Progress", handledBy: null, seenByIt: false })).toBe("Sent to IT");
  });

  it("uses the person's name when a sign-in help request has no enterprise", () => {
    expect(requestPlace(requests[1])).toBe("Joy Villanueva");
  });

  it("shows New and Updated marks from the server", () => {
    expect(requests.slice(0, 3).map(requestMarker)).toEqual(["New", "Updated", null]);
    expect(countUnread(requests)).toBe(2);
    expect(unreadLabel(0)).toBe("All caught up");
  });

  it("offers every type and progress, even ones no request is in", () => {
    expect(categoryFilterOptions.map(([, label]) => label)).toEqual(["All types", "Camera Issue", "Report Concern", "Account and Access", "Desktop app and Maintenance", "Others"]);
    expect(progressFilterOptions.map(([, label]) => label)).toEqual(["All progress", "Resolved", "In Progress", "Seen by IT"]);
  });

  it("groups requests under day headings", () => {
    expect(groupRequestsByDay(requests.slice(0, 3), now).map((group) => group.label)).toEqual(["Today", "Yesterday", "Nov 20"]);
  });

  it("opens the request in the address, by ID or code", () => {
    expect(findLinkedRequest(requests, new URLSearchParams("request=help"))?.id).toBe("help");
    expect(findLinkedRequest(requests, new URLSearchParams("request=REQ-change"))?.id).toBe("change");
    expect(findLinkedRequest(requests, new URLSearchParams("request=missing"))).toBeNull();
  });

  it("keeps saved filters only when they match the Type and Progress options", () => {
    expect(isRequestFilters(initialRequestFilters)).toBe(true);
    expect(isRequestFilters({ query: "gate", category: "Camera Issue", progress: "Seen by IT" })).toBe(true);
    // The old Type and Status design, and old group names, are dropped.
    expect(isRequestFilters({ query: "", group: "all", status: "all" })).toBe(false);
    expect(isRequestFilters({ query: "", category: "Desktop app or camera problem", progress: "all" })).toBe(false);
    expect(isRequestFilters({ query: "", category: "all", progress: "Approved" })).toBe(false);
    expect(hasActiveFilters({ ...initialRequestFilters, progress: "Resolved" })).toBe(true);
    expect(hasActiveFilters(initialRequestFilters)).toBe(false);
  });
});
