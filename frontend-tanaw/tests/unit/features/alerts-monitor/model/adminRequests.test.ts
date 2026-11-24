import { describe, expect, it } from "vitest";
import {
  alertRequestType,
  buildAdminRequests,
  filterRequests,
  findLinkedRequest,
  formatRequestWhen,
  groupRequestsByDay,
  hasActiveFilters,
  initialRequestFilters,
  isRequestFilters,
  progressFilterOptions,
  quickInstructions,
  requestSearchParams,
  statusProgress,
  ticketRequestType,
  type AdminRequest,
} from "@/features/alerts-monitor/model/adminRequests";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { AccountProfileChangeRequest, AccountSummary, PriorityAlert } from "@/shared/types";

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "ticket-1",
    code: "TCK-000123",
    enterpriseId: "ENT-001",
    enterpriseName: "San Pedro Plaza",
    submittedBy: "San Pedro Plaza",
    category: "Camera Issue",
    priority: "Urgent",
    subject: "Entrance camera is offline",
    description: "The entrance camera stopped counting.",
    affectedArea: "Main entrance",
    cameraNode: "Entrance camera",
    attachments: [],
    status: "Open",
    createdAt: "2026-11-23T05:05:00Z",
    updatedAt: "2026-11-23T05:05:00Z",
    ...overrides,
  };
}

function alert(overrides: Partial<PriorityAlert> = {}): PriorityAlert {
  return {
    id: "ALT-000007",
    type: "Submission Delay",
    severity: "Warning",
    urgency: "Important",
    enterprise: "San Pedro Plaza",
    requester: "San Pedro Plaza",
    summary: "San Pedro Plaza has not sent its October report.",
    requiredAction: "Follow up with the enterprise.",
    resolutionMode: "Admin Monitoring",
    status: "New",
    owner: "Admin",
    time: "2026-11-22T02:00:00Z",
    ...overrides,
  };
}

function change(overrides: Partial<AccountProfileChangeRequest> = {}): AccountProfileChangeRequest {
  return {
    type: "contactNumber",
    label: "Contact Number",
    requestedValue: "09171234567",
    requestedAt: "2026-11-21T01:00:00Z",
    requestId: null,
    status: "pending_review",
    isVerified: false,
    canApprove: true,
    expiresAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "account-1",
    email: "plaza@example.test",
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: "San Pedro Plaza",
    category: null,
    managerName: "Maria Santos",
    barangay: "Poblacion",
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId: "ENT-001",
    gatewayStatus: null,
    buildingCapacity: 100,
    displayName: "San Pedro Plaza",
    role: "enterprise",
    title: "Enterprise Account",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [change()],
    createdAt: "2026-01-01T00:00:00Z",
    lastLoginAt: null,
    ...overrides,
  };
}

const requests = buildAdminRequests({ alerts: [alert()], tickets: [ticket()], accounts: [account()] });
const byKind = (kind: AdminRequest["kind"]) => requests.find((request) => request.kind === kind) as AdminRequest;

describe("request types", () => {
  it("maps ticket categories to the Requests types", () => {
    expect(ticketRequestType("Camera Issue")).toBe("Camera issue");
    expect(ticketRequestType("Report Concern")).toBe("Report concern");
    expect(ticketRequestType("Maintenance")).toBe("Desktop app and maintenance");
    expect(ticketRequestType("Account & Security")).toBe("Account and access");
    expect(ticketRequestType("Other")).toBe("Other");
    expect(ticketRequestType("Something new")).toBe("Other");
  });

  it("maps alert types to the Requests types", () => {
    expect(alertRequestType("Maintenance Request")).toBe("Desktop app and maintenance");
    expect(alertRequestType("Failed Login Threshold")).toBe("Account and access");
    expect(alertRequestType("Password Reset Request")).toBe("Account and access");
    expect(alertRequestType("Submission Delay")).toBe("Report concern");
    expect(alertRequestType("Foot Traffic Alert")).toBe("Other");
  });

  it("files profile change requests under account and access", () => {
    expect(byKind("account").type).toBe("Account and access");
  });
});

describe("request progress", () => {
  it("maps New and Open to Seen by IT, In Review to In progress and Resolved to Resolved", () => {
    expect(statusProgress("New")).toBe("seen");
    expect(statusProgress("Open")).toBe("seen");
    expect(statusProgress("In Review")).toBe("in-progress");
    expect(statusProgress("Resolved")).toBe("resolved");
  });

  it("marks new Admin-owned alerts as needing attention instead", () => {
    expect(statusProgress("New", true)).toBe("attention");
    expect(byKind("alert").progress).toBe("attention");
    expect(buildAdminRequests({ alerts: [alert({ owner: "System" })], tickets: [], accounts: [] })[0]?.progress).toBe("seen");
    expect(byKind("account").progress).toBe("seen");
  });

  it("only offers Needs attention as a filter when such alerts exist", () => {
    expect(progressFilterOptions(requests).map(([value]) => value)).toEqual(["all", "resolved", "in-progress", "seen", "attention"]);
    expect(progressFilterOptions([byKind("ticket")]).map(([value]) => value)).toEqual(["all", "resolved", "in-progress", "seen"]);
  });
});

describe("merging sources", () => {
  it("leaves out more-visitors-than-usual alerts, which the Dashboard map shows", () => {
    const crowd = [alert({ id: "ALT-CROWD-1", type: "Foot Traffic Alert" }), alert({ id: "ALT-CROWD-2", type: "Occupancy Spike" })];
    expect(buildAdminRequests({ alerts: [...crowd, alert()], tickets: [], accounts: [] }).map((request) => request.sourceId)).toEqual(["ALT-000007"]);
  });

  it("lists every source newest first", () => {
    expect(requests.map((request) => request.key)).toEqual(["ticket:ticket-1", "alert:ALT-000007", "account:account-1:contactNumber"]);
  });

  it("describes a ticket with its enterprise contact and link", () => {
    const request = byKind("ticket");
    expect(request).toMatchObject({
      title: "Entrance camera is offline",
      place: "San Pedro Plaza",
      enterpriseId: "ENT-001",
      sentBy: "Maria Santos, San Pedro Plaza",
      contactFirstName: "Maria",
      reference: "TCK-000123",
      area: "Main entrance",
      sourceType: "support.ticket",
    });
  });

  it("links an alert to its enterprise by name and says TANAW raised it", () => {
    const request = byKind("alert");
    expect(request.enterpriseId).toBe("ENT-001");
    expect(request.sentBy).toBe("TANAW, automatic alert");
    expect(request.title).toBe("Late enterprise report");
    expect(request.reference).toBe("ALT-000007");
  });

  it("describes a profile change in plain words", () => {
    const request = byKind("account");
    expect(request.title).toBe("Change of contact number");
    expect(request.what).toBe("San Pedro Plaza asked to change its contact number to 09171234567. It is waiting for IT to approve it.");
    expect(request.reference).toBeNull();
    expect(request.sourceType).toBe("enterprise.profile");
  });

  it("changes the version when a ticket is updated, so it can show as Updated", () => {
    const updated = buildAdminRequests({ alerts: [], tickets: [ticket({ status: "In Review", updatedAt: "2026-11-23T06:00:00Z" })], accounts: [] })[0];
    expect(updated?.version).not.toBe(byKind("ticket").version);
  });
});

describe("search and filters", () => {
  it("matches title, place and reference number", () => {
    expect(filterRequests(requests, { ...initialRequestFilters, query: "tck-000123" }).map((request) => request.kind)).toEqual(["ticket"]);
    expect(filterRequests(requests, { ...initialRequestFilters, query: "late enterprise" }).map((request) => request.kind)).toEqual(["alert"]);
    expect(filterRequests(requests, { ...initialRequestFilters, query: "san pedro" })).toHaveLength(3);
    expect(filterRequests(requests, { ...initialRequestFilters, query: "Maria" })).toHaveLength(0);
  });

  it("filters by type and progress", () => {
    expect(filterRequests(requests, { ...initialRequestFilters, type: "Account and access" }).map((request) => request.kind)).toEqual(["account"]);
    expect(filterRequests(requests, { ...initialRequestFilters, progress: "seen" }).map((request) => request.kind)).toEqual(["ticket", "account"]);
    expect(filterRequests(requests, { query: "plaza", type: "Camera issue", progress: "resolved" })).toEqual([]);
  });

  it("knows when filters are active and validates stored filters", () => {
    expect(hasActiveFilters(initialRequestFilters)).toBe(false);
    expect(hasActiveFilters({ ...initialRequestFilters, query: "  " })).toBe(false);
    expect(hasActiveFilters({ ...initialRequestFilters, progress: "resolved" })).toBe(true);
    expect(isRequestFilters({ query: "", type: "Other", progress: "in-progress" })).toBe(true);
    expect(isRequestFilters({ query: "", type: "Camera Issue", progress: "all" })).toBe(false);
    expect(isRequestFilters(null)).toBe(false);
  });
});

describe("grouping by day", () => {
  const now = new Date("2026-11-23T08:00:00Z"); // 4:00 PM on Nov 23 in Manila

  it("labels today, yesterday and older days in Philippine time", () => {
    const groups = groupRequestsByDay(requests, now);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Nov 21"]);
    expect(groups[0]?.requests.map((request) => request.kind)).toEqual(["ticket"]);
  });

  it("uses the Manila calendar day, not UTC", () => {
    // 11:30 PM UTC on Nov 22 is already Nov 23 in Manila.
    const late = buildAdminRequests({ alerts: [], tickets: [ticket({ createdAt: "2026-11-22T23:30:00Z" })], accounts: [] });
    expect(groupRequestsByDay(late, now)[0]?.label).toBe("Today");
  });

  it("adds the year for other years and keeps undated requests last", () => {
    const mixed = buildAdminRequests({
      alerts: [alert({ time: "2025-12-31T02:00:00Z" })],
      tickets: [],
      accounts: [account({ profileChangeRequests: [change({ requestedAt: null })] })],
    });
    expect(groupRequestsByDay(mixed, now).map((group) => group.label)).toEqual(["Dec 31, 2025", "Date not recorded"]);
  });

  it("formats update times relative to now", () => {
    expect(formatRequestWhen("2026-11-23T07:59:30Z", now, "12-hour")).toBe("Just now");
    expect(formatRequestWhen("2026-11-23T06:05:00Z", now, "12-hour")).toBe("2:05 PM");
    expect(formatRequestWhen("2026-11-21T06:05:00Z", now, "24-hour")).toBe("Nov 21, 14:05");
    expect(formatRequestWhen(null, now, "12-hour")).toBe("");
  });
});

describe("deep links", () => {
  it("selects the request a notification names", () => {
    expect(findLinkedRequest(requests, new URLSearchParams("alert=ALT-000007"))?.kind).toBe("alert");
    expect(findLinkedRequest(requests, new URLSearchParams("ticket=ticket-1"))?.kind).toBe("ticket");
    expect(findLinkedRequest(requests, new URLSearchParams("account=account-1"))?.kind).toBe("account");
    expect(findLinkedRequest(requests, new URLSearchParams("ticket=missing"))).toBeNull();
    expect(findLinkedRequest(requests, new URLSearchParams(""))).toBeNull();
  });

  it("picks one of two profile changes with the change parameter", () => {
    const both = buildAdminRequests({ alerts: [], tickets: [], accounts: [account({ profileChangeRequests: [change(), change({ type: "businessEmail", label: "Business Email", requestedValue: "new@example.test" })] })] });
    expect(findLinkedRequest(both, new URLSearchParams("account=account-1&change=businessEmail"))?.changeType).toBe("businessEmail");
    const target = both.find((request) => request.changeType === "businessEmail") as AdminRequest;
    expect(requestSearchParams(target)).toEqual({ account: "account-1", change: "businessEmail" });
    expect(requestSearchParams(byKind("ticket"))).toEqual({ ticket: "ticket-1" });
  });
});

describe("quick instructions", () => {
  it("fills in the place and the contact's first name", () => {
    const [onSite, call] = quickInstructions(byKind("ticket"));
    expect(onSite?.text).toBe("Can someone go to San Pedro Plaza today to check this in person, please?");
    expect(call?.text).toBe("Please call Maria at San Pedro Plaza to get more details about this.");
    expect(quickInstructions(byKind("alert"))[1]?.text).toBe("Please call San Pedro Plaza to get more details about this.");
  });
});
