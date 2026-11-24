import { describe, expect, it } from "vitest";
import {
  countUnread,
  filterRequests,
  findLinkedRequest,
  groupRequestsByDay,
  initialRequestFilters,
  isRequestFilters,
  requestMarker,
  requestPlace,
  statusFilterOptions,
  unreadLabel,
} from "../../../../../src/features/alerts-monitor/model/adminRequests";
import { request } from "../../../fixtures/requests";

const now = new Date("2026-11-23T08:00:00Z");

describe("Admin Requests list", () => {
  const requests = [
    request({ id: "camera", createdAt: "2026-11-23T06:00:00Z", unread: true }),
    request({ id: "help", group: "Sign-in help", title: "Sign-in help", enterpriseName: null, enterpriseId: null, requesterName: "Joy Villanueva", createdAt: "2026-11-22T06:00:00Z", updated: true }),
    request({ id: "change", group: "Account change", title: "Change of contact number", status: "Approved", createdAt: "2026-11-20T06:00:00Z" }),
  ];

  it("filters by group, status and search, newest first", () => {
    expect(filterRequests(requests, initialRequestFilters).map((item) => item.id)).toEqual(["camera", "help", "change"]);
    expect(filterRequests(requests, { ...initialRequestFilters, group: "Sign-in help" }).map((item) => item.id)).toEqual(["help"]);
    expect(filterRequests(requests, { ...initialRequestFilters, status: "Approved" }).map((item) => item.id)).toEqual(["change"]);
    expect(filterRequests(requests, { ...initialRequestFilters, query: "joy" }).map((item) => item.id)).toEqual(["help"]);
  });

  it("uses the person's name when a sign-in help request has no enterprise", () => {
    expect(requestPlace(requests[1])).toBe("Joy Villanueva");
  });

  it("shows New and Updated marks from the server", () => {
    expect(requests.map(requestMarker)).toEqual(["New", "Updated", null]);
    expect(countUnread(requests)).toBe(2);
    expect(unreadLabel(0)).toBe("All caught up");
  });

  it("offers only the statuses some request has", () => {
    expect(statusFilterOptions(requests).map(([value]) => value)).toEqual(["all", "Sent", "Approved"]);
  });

  it("groups requests under day headings", () => {
    expect(groupRequestsByDay(requests, now).map((group) => group.label)).toEqual(["Today", "Yesterday", "Nov 20"]);
  });

  it("opens the request in the address, by ID or code", () => {
    expect(findLinkedRequest(requests, new URLSearchParams("request=help"))?.id).toBe("help");
    expect(findLinkedRequest(requests, new URLSearchParams("request=REQ-change"))?.id).toBe("change");
    expect(findLinkedRequest(requests, new URLSearchParams("request=missing"))).toBeNull();
  });

  it("rejects saved filters from the old Type and Progress design", () => {
    expect(isRequestFilters({ query: "", type: "all", progress: "all" })).toBe(false);
    expect(isRequestFilters(initialRequestFilters)).toBe(true);
  });
});
