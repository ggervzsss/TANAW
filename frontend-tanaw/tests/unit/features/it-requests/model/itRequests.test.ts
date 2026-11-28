import { describe, expect, it } from "vitest";
import {
  approveBlockedReason,
  areaAndCamera,
  activeFilterCount,
  buildTimeline,
  defaultFilters,
  desktopAppStatus,
  filterItRequests,
  filtersToParams,
  findSelectedRequest,
  formatReceived,
  formatWhen,
  handledByLabel,
  itEnterpriseLink,
  moveOptions,
  ownerShort,
  parseFilters,
  quickReplies,
  requestActions,
  requestProgress,
  requestState,
  stateLabels,
  statusNote,
  type Viewer,
} from "../../../../../src/features/it-requests/model";
import type { EnterpriseHealth } from "../../../../../src/shared/services/enterpriseHealth";
import type { Request, RequestMessage } from "../../../../../src/shared/services/requests";

// 4:00 PM on Nov 23, 2026 in Manila.
const NOW = new Date("2026-11-23T08:00:00Z");
const ME: Viewer = { id: "it-me", name: "Ana Reyes" };
const CARLO = { accountId: "it-carlo", name: "Carlo Mendoza" };
const ANA = { accountId: "it-me", name: "Ana Reyes" };

function request(overrides: Partial<Request> = {}): Request {
  return {
    id: "r1",
    code: "REQ-000001",
    group: "Desktop app or camera problem",
    title: "Entrance camera keeps disconnecting",
    description: "The entrance camera drops off every few minutes.",
    status: "In Progress",
    enterpriseId: "ENT-1",
    enterpriseName: "Balon ni Lolo Uweng",
    requesterName: "Jose Ramos",
    requesterEmail: null,
    affectedArea: null,
    camera: null,
    attachments: [],
    accountChange: null,
    handledBy: null,
    handledAt: null,
    closedAt: null,
    unread: false,
    updated: false,
    seenByIt: false,
    createdAt: "2026-11-23T05:40:00Z",
    updatedAt: "2026-11-23T05:40:00Z",
    ...overrides,
  };
}

const contactChange = { field: "contactNumber" as const, label: "Contact number", currentValue: "0917 555 0142", requestedValue: "0917 555 0199", verification: null, canApprove: true };

const sample = [
  request({ id: "waiting", code: "REQ-000148" }),
  request({ id: "mine", code: "REQ-000145", title: "Cannot sign in", group: "Sign-in help", handledBy: ANA, handledAt: "2026-11-23T00:30:00Z", createdAt: "2026-11-23T00:12:00Z" }),
  request({ id: "carlo", code: "REQ-000149", title: "Gate A camera", handledBy: CARLO, handledAt: "2026-11-23T07:40:00Z", createdAt: "2026-11-23T07:30:00Z" }),
  request({
    id: "resolved",
    code: "REQ-000146",
    group: "Report problem",
    title: "October report upload failed",
    status: "Resolved",
    handledBy: CARLO,
    closedAt: "2026-11-22T02:40:00Z",
    createdAt: "2026-11-22T02:05:00Z",
  }),
  request({
    id: "approved",
    code: "REQ-000141",
    group: "Account change",
    title: "Change business email",
    status: "Approved",
    handledBy: ANA,
    accountChange: { ...contactChange, canApprove: false },
    createdAt: "2026-11-21T01:15:00Z",
  }),
];

describe("IT request filters", () => {
  it("reads the filters from the address and falls back to the defaults", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual(defaultFilters);
    // The retired Handled by filter (`owner`) still loads, and is ignored.
    expect(parseFilters(new URLSearchParams("q=gate&type=account-change&status=resolved&owner=me"))).toEqual({ query: "gate", type: "Account change", status: "resolved" });
    expect(parseFilters(new URLSearchParams("type=nope&status=nope&owner="))).toEqual(defaultFilters);
  });

  it("writes only the filters that differ from the defaults, keeps the selected request and drops the retired owner", () => {
    const params = filtersToParams({ ...defaultFilters, type: "Sign-in help" }, new URLSearchParams("request=r1&q=old&owner=it-carlo"));
    expect(params.toString()).toBe("request=r1&type=sign-in");
    expect(filtersToParams(defaultFilters, new URLSearchParams("status=all")).toString()).toBe("");
  });

  it("counts the filters that differ from the default view", () => {
    expect(activeFilterCount(defaultFilters)).toBe(0);
    expect(activeFilterCount({ ...defaultFilters, query: "  " })).toBe(0);
    expect(activeFilterCount({ query: "gate", type: "Other", status: "all" })).toBe(3);
  });

  it("shows open requests by default, newest first", () => {
    expect(filterItRequests(sample, defaultFilters).map((item) => item.id)).toEqual(["carlo", "waiting", "mine"]);
  });

  it("lists open requests before closed ones, each newest first", () => {
    const reopened = request({ id: "old-open", code: "REQ-000100", createdAt: "2026-11-20T01:00:00Z" });
    expect(filterItRequests([...sample, reopened], { ...defaultFilters, status: "all" }).map((item) => item.id)).toEqual(["carlo", "waiting", "mine", "old-open", "resolved", "approved"]);
  });

  it("filters by status, type and search", () => {
    const ids = (filters: Partial<typeof defaultFilters>) => filterItRequests(sample, { ...defaultFilters, ...filters }).map((item) => item.id);
    expect(ids({ status: "not-picked-up" })).toEqual(["waiting"]);
    expect(ids({ status: "in-progress" })).toEqual(["carlo", "mine"]);
    expect(ids({ status: "resolved" })).toEqual(["resolved"]);
    expect(ids({ status: "approved" })).toEqual(["approved"]);
    expect(ids({ status: "all" })).toHaveLength(5);
    expect(ids({ status: "all", type: "Account change" })).toEqual(["approved"]);
    expect(ids({ status: "all", query: "req-000146" })).toEqual(["resolved"]);
    expect(ids({ status: "all", query: "lolo uweng" })).toHaveLength(5);
  });

  it("finds the selected request by ID or reference number", () => {
    expect(findSelectedRequest(sample, new URLSearchParams("request=mine"))?.id).toBe("mine");
    expect(findSelectedRequest(sample, new URLSearchParams("request=REQ-000149"))?.id).toBe("carlo");
    expect(findSelectedRequest(sample, new URLSearchParams("request=missing"))).toBeNull();
  });
});

describe("IT request status", () => {
  it("labels each state", () => {
    expect(sample.map((item) => stateLabels[requestState(item)])).toEqual(["Not picked up", "In progress", "In progress", "Resolved", "Approved"]);
  });

  it("says each row's progress and who has it", () => {
    expect(requestProgress(sample[0], ME)).toEqual({ state: "not-picked-up", label: "Not picked up yet", owner: "" });
    expect(requestProgress(sample[1], ME)).toEqual({ state: "in-progress", label: "In progress", owner: "You" });
    expect(requestProgress(sample[2], ME)).toEqual({ state: "in-progress", label: "In progress", owner: "Carlo Mendoza" });
    expect(requestProgress(sample[3], ME)).toEqual({ state: "resolved", label: "Resolved", owner: "Carlo Mendoza" });
  });

  it("names who handles a request", () => {
    expect(handledByLabel(sample[0], ME)).toBe("Not picked up yet");
    expect(handledByLabel(sample[1], ME)).toBe("You (Ana Reyes)");
    expect(handledByLabel(sample[2], ME)).toBe("Carlo Mendoza");
    expect(handledByLabel(request({ status: "Resolved" }), ME)).toBe("IT");
    expect(ownerShort(sample[1], ME)).toBe("You");
    expect(ownerShort(sample[0], ME)).toBe("");
  });

  it("writes the status line", () => {
    const at = (value: string) => formatWhen(value, NOW, "MMM d, yyyy", "12-hour");
    expect(statusNote(sample[0], ME, at)).toBe("Nobody in IT has picked this up yet. The sender is waiting.");
    expect(statusNote(sample[1], ME, at)).toBe("You started on this at 8:30 AM.");
    expect(statusNote(sample[2], ME, at)).toBe("Carlo Mendoza started on this at 3:40 PM. You can still reply or help.");
    expect(statusNote(sample[3], ME, at)).toBe("Resolved by Carlo Mendoza at Nov 22, 2026, 10:40 AM. You or the sender can reopen it.");
    expect(statusNote(request({ status: "Approved", handledBy: ANA, accountChange: contactChange }), ME, at)).toBe("Approved by you. The change is now in use.");
    expect(statusNote(request({ status: "Resolved", handledBy: CARLO, accountChange: contactChange }), ME, at)).toBe("Declined by Carlo Mendoza. The old contact number stays.");
  });
});

describe("IT request actions", () => {
  it("offers Start on it, Mark resolved and Move for an open problem nobody has picked up", () => {
    expect(requestActions(sample[0])).toEqual({ canStart: true, canDecide: false, canResolve: true, canReopen: false, canMove: true, canReply: true });
  });

  it("offers Approve and Decline for an open account change, and no move", () => {
    const change = request({ group: "Account change", accountChange: contactChange });
    expect(requestActions(change)).toMatchObject({ canStart: true, canDecide: true, canResolve: false, canMove: false, canReopen: false });
  });

  it("reopens a resolved problem but never a decided account change", () => {
    expect(requestActions(sample[3])).toMatchObject({ canReopen: true, canReply: false, canMove: false });
    expect(requestActions(sample[4])).toMatchObject({ canReopen: false, canDecide: false, canReply: false });
    expect(requestActions(request({ status: "Resolved", group: "Account change", accountChange: contactChange })).canReopen).toBe(false);
  });

  it("explains why a change can't be approved", () => {
    expect(approveBlockedReason(contactChange)).toBeNull();
    expect(approveBlockedReason({ ...contactChange, field: "businessEmail", verification: "pending_verification", canApprove: false })).toMatch(/not verified yet/);
    expect(approveBlockedReason({ ...contactChange, field: "businessEmail", verification: "expired", canApprove: false })).toMatch(/expired/);
  });

  it("moves to every type except Account change", () => {
    expect(moveOptions(sample[0])).toEqual([
      { group: "Sign-in help", selected: false },
      { group: "Desktop app or camera problem", selected: true },
      { group: "Report problem", selected: false },
      { group: "Other", selected: false },
    ]);
  });

  it("offers quick replies for account changes and for other problems", () => {
    expect(quickReplies(sample[0]).map((reply) => reply.label)).toEqual(["Restart the app", "Check the cable", "Looking into it"]);
    const change = quickReplies(request({ group: "Account change", accountChange: contactChange }));
    expect(change.map((reply) => reply.label)).toEqual(["Ask for proof", "Number not reachable"]);
    expect(change[0].text).toBe("Please send a photo of the document that shows the new contact number.");
    expect(quickReplies(request({ group: "Account change", accountChange: { ...contactChange, field: "businessEmail", label: "Business email" } })).map((reply) => reply.label)).toEqual([
      "Ask for proof",
      "Verify the email",
    ]);
  });
});

describe("IT request days and timeline", () => {
  it("says when a request arrived: the time today, Yesterday, then the date and time", () => {
    expect(formatReceived("2026-11-23T05:40:00Z", NOW, "d MMM yyyy", "12-hour")).toBe("1:40 PM");
    expect(formatReceived("2026-11-22T02:05:00Z", NOW, "d MMM yyyy", "12-hour")).toBe("Yesterday, 10:05 AM");
    expect(formatReceived("2026-11-21T01:15:00Z", NOW, "yyyy-MM-dd", "24-hour")).toBe("2026-11-21, 09:15");
    expect(formatReceived(null, NOW, "d MMM yyyy", "12-hour")).toBe("Date unavailable");
  });

  it("formats when something happened", () => {
    expect(formatWhen("2026-11-23T07:59:30Z", NOW, "MMM d, yyyy", "12-hour")).toBe("Just now");
    expect(formatWhen("2026-11-23T07:30:00Z", NOW, "MMM d, yyyy", "24-hour")).toBe("15:30");
    expect(formatWhen("2026-11-21T01:15:00Z", NOW, "yyyy-MM-dd", "12-hour")).toBe("2026-11-21, 9:15 AM");
    expect(formatWhen(null, NOW, "MMM d, yyyy", "12-hour")).toBe("");
  });

  it("builds the conversation newest first, ending with when it was sent", () => {
    const message = (id: string, kind: RequestMessage["kind"], text: string, role: string, createdAt: string, authorName = "Carlo Mendoza"): RequestMessage => ({
      id,
      requestId: "r1",
      authorId: role,
      authorName,
      authorRole: role,
      kind,
      message: text,
      createdAt,
    });
    const timeline = buildTimeline(request({ attachments: [{ id: "a", fileName: "a.png", mediaType: "image/png", sizeBytes: 1, url: "/x" }] }), {
      messages: [
        message("m1", "status", "Carlo Mendoza started on it.", "it", "2026-11-23T07:40:00Z"),
        message("m2", "message", "Please check the power cable.", "it", "2026-11-23T07:42:00Z"),
        message("m3", "note", "Please check Gate A before Saturday.", "admin", "2026-11-23T07:45:00Z", "LGU Admin"),
        message("m4", "message", "Done, still freezing.", "enterprise", "2026-11-23T07:50:00Z", "Jose Ramos"),
        message("m5", "status", "Resolved", "it", "2026-11-23T07:55:00Z"),
      ],
    });
    expect(timeline.map((entry) => [entry.title, entry.kind])).toEqual([
      ["Resolved", "resolved"],
      ["Message from Jose Ramos", "message"],
      ["Note from LGU Admin, Admin", "note"],
      ["Reply from IT", "reply"],
      ["In progress", "progress"],
      ["Request sent", "sent"],
    ]);
    expect(timeline[3].detail).toBe("Carlo Mendoza: Please check the power cable.");
    expect(timeline.at(-1)?.detail).toBe("Sent from the desktop app, with 1 photo.");
  });

  it("calls a resolved account change Declined", () => {
    const change = request({ group: "Account change", accountChange: contactChange });
    const timeline = buildTimeline(change, {
      messages: [{ id: "m1", requestId: "r1", authorId: "it", authorName: "Ana Reyes", authorRole: "it", kind: "status", message: "Resolved", createdAt: "2026-11-23T07:00:00Z" }],
    });
    expect(timeline[0]).toMatchObject({ title: "Declined", detail: "Ana Reyes declined the change. The old value stays." });
    expect(timeline[1].detail).toBe("Sent by TANAW when the contact number was edited in the desktop app.");
  });
});

describe("IT request details", () => {
  const health = (overrides: Partial<EnterpriseHealth> = {}, app: Partial<EnterpriseHealth["app"]> = {}): EnterpriseHealth => ({
    accountId: "acc-1",
    enterpriseId: "ENT-1",
    name: "Balon ni Lolo Uweng",
    category: "Heritage",
    accountState: "active",
    openNow: true,
    closedReason: null,
    cameras: { total: 0, counting: 0, list: [] },
    app: { status: "online", lastDataAt: "2026-11-23T07:59:00Z", version: "0.1.3", latestVersion: "0.1.3", computerName: null, ...app },
    ...overrides,
  });
  const when = (value: string) => formatWhen(value, NOW, "MMM d, yyyy", "12-hour");

  it("describes the desktop app", () => {
    expect(desktopAppStatus(health(), NOW, when)).toEqual({ label: "Online", tone: "ok" });
    expect(desktopAppStatus(health({}, { computerName: "FRONT-DESK" }), NOW, when).label).toBe("Online on FRONT-DESK");
    expect(desktopAppStatus(health({}, { status: "delayed", lastDataAt: "2026-11-23T07:46:00Z" }), NOW, when)).toEqual({ label: "Delayed, last data 14 min ago", tone: "warn" });
    expect(desktopAppStatus(health({}, { status: "offline", lastDataAt: "2026-11-23T03:00:00Z" }), NOW, when)).toEqual({ label: "Offline, last data 11:00 AM", tone: "danger" });
    expect(desktopAppStatus(health({}, { status: "not_set_up", lastDataAt: null }), NOW, when).label).toBe("Not set up yet");
    expect(desktopAppStatus(health({ openNow: false, closedReason: "Holiday" }), NOW, when).label).toBe("Closed now (Holiday)");
    expect(desktopAppStatus(health({ accountState: "deactivated" }), NOW, when).label).toBe("Account deactivated");
  });

  it("joins the area and camera", () => {
    expect(areaAndCamera({ affectedArea: "Gate A", camera: "Main entrance" })).toBe("Gate A, Main entrance");
    expect(areaAndCamera({ affectedArea: null, camera: " " })).toBe("Not given");
  });

  it("links a place to its manage screen", () => {
    expect(itEnterpriseLink("ENT 1")).toBe("/it/enterprises/ENT%201");
  });
});
