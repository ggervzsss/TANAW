import { describe, expect, it } from "vitest";
import {
  accountRows,
  accountsFigure,
  camerasFigure,
  connectionRows,
  emailKind,
  emailRows,
  firstRows,
  formatWhen,
  greeting,
  markRequestStarted,
  placesFigure,
  requestRows,
  requestsFigure,
  statusLine,
  type OverviewAccount,
  type OverviewEmail,
} from "../../../../../src/features/it-overview/model/itOverview";
import type { CameraHealth, EnterpriseHealth } from "../../../../../src/shared/services/enterpriseHealth";
import { request } from "../../../fixtures/requests";

// 2026-11-26 14:30 in Manila.
const now = new Date("2026-11-26T06:30:00Z");
const formats = { dateFormat: "MMM d, yyyy", timeFormat: "12-hour" } as const;
const viewer = { id: "it-ana", displayName: "Ana Reyes", firstName: "Ana" };
const noIds: ReadonlySet<string> = new Set();

function camera(id: string, status: CameraHealth["status"], overrides: Partial<CameraHealth> = {}): CameraHealth {
  return { id, name: `Camera ${id}`, status, mode: "entrance_exit", brand: null, since: null, note: null, ...overrides };
}

function place(enterpriseId: string, overrides: Partial<EnterpriseHealth> = {}): EnterpriseHealth {
  return {
    accountId: `acct-${enterpriseId}`,
    enterpriseId,
    name: `Place ${enterpriseId}`,
    barangay: "Poblacion",
    category: "Park",
    accountState: "active",
    app: { status: "online", lastDataAt: "2026-11-26T06:29:30Z", version: "0.1.3", latestVersion: "0.1.3", computerName: null },
    openNow: true,
    closedReason: null,
    cameras: { total: 2, counting: 2, list: [camera("1", "counting"), camera("2", "counting")] },
    ...overrides,
  };
}

function account(id: string, overrides: Partial<OverviewAccount> = {}): OverviewAccount {
  return {
    id,
    email: `${id}@example.test`,
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId: null,
    gatewayStatus: null,
    buildingCapacity: 0,
    displayName: id,
    role: "staff",
    title: "LGU Staff",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-11-01T00:00:00Z",
    lastLoginAt: null,
    invitation: null,
    ...overrides,
  };
}

function email(id: string, overrides: Partial<OverviewEmail> = {}): OverviewEmail {
  return {
    id,
    purpose: "account_activation",
    recipient: `${id}@example.test`,
    provider: "brevo",
    status: "accepted",
    attemptCount: 1,
    maxAttempts: 5,
    manualRetryCount: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    errorCode: null,
    failureReason: null,
    outcomeUncertain: false,
    canRetry: false,
    createdAt: "2026-11-25T08:05:00Z",
    acceptedAt: null,
    ...overrides,
  };
}

describe("IT Overview header", () => {
  it("greets by the time of day in Manila with the first name", () => {
    expect(greeting(new Date("2026-11-25T23:30:00Z"), viewer)).toBe("Good morning, Ana");
    expect(greeting(now, viewer)).toBe("Good afternoon, Ana");
    expect(greeting(new Date("2026-11-26T11:00:00Z"), viewer)).toBe("Good evening, Ana");
    expect(greeting(now, { id: "x", displayName: "Carlo Mendoza", firstName: null })).toBe("Good afternoon, Carlo");
    expect(greeting(now, null)).toBe("Good afternoon");
  });

  it("says whether the screen is current and when it last refreshed", () => {
    expect(statusLine({ isLoading: true, hasError: false, online: true, lastUpdatedAt: 0, now })).toBe("Loading the latest information.");
    expect(statusLine({ isLoading: false, hasError: false, online: true, lastUpdatedAt: now.getTime() - 20_000, now })).toBe("Connections are live. Last update just now.");
    expect(statusLine({ isLoading: false, hasError: false, online: true, lastUpdatedAt: now.getTime() - 90_000, now })).toBe("Connections are live. Last update 1 min ago.");
    expect(statusLine({ isLoading: false, hasError: true, online: true, lastUpdatedAt: now.getTime() - 300_000, now })).toBe("Some information could not be loaded. Last update 5 min ago.");
    expect(statusLine({ isLoading: false, hasError: false, online: false, lastUpdatedAt: now.getTime(), now })).toBe("You are offline. Last update just now.");
  });

  it("shows a time today, yesterday with a time, and a date before that", () => {
    expect(formatWhen("2026-11-26T05:40:00Z", now, formats)).toBe("1:40 PM");
    expect(formatWhen("2026-11-25T08:05:00Z", now, formats)).toBe("Yesterday, 4:05 PM");
    expect(formatWhen("2026-11-21T03:00:00Z", now, formats)).toBe("Nov 21, 2026");
    expect(formatWhen("2026-11-21T03:00:00Z", now, { dateFormat: "yyyy-MM-dd", timeFormat: "24-hour" })).toBe("2026-11-21");
  });
});

describe("Requests waiting for IT", () => {
  const requests = [
    request({ id: "old-waiting", createdAt: "2026-11-26T00:12:00Z" }),
    request({ id: "new-waiting", createdAt: "2026-11-26T05:40:00Z", group: "Account change", title: "Change enterprise name" }),
    request({ id: "mine", createdAt: "2026-11-21T03:00:00Z", handledBy: { accountId: "it-ana", name: "Ana Reyes" }, handledAt: "2026-11-25T01:00:00Z" }),
    request({ id: "theirs", handledBy: { accountId: "it-carlo", name: "Carlo Mendoza" } }),
    request({ id: "resolved", status: "Resolved" }),
  ];

  it("lists the requests not picked up, newest first, then the viewer's own", () => {
    const rows = requestRows(requests, viewer, noIds, now, formats);
    expect(rows.map((row) => row.id)).toEqual(["new-waiting", "old-waiting", "mine"]);
    expect(rows[0]).toMatchObject({ canStart: true, state: "waiting", stateLabel: "Not picked up yet", when: "1:40 PM", href: "/it/requests?request=new-waiting", place: "Sampaguita Gardens" });
    expect(rows[2]).toMatchObject({ canStart: false, state: "mine", stateLabel: "In progress, yours" });
  });

  it("counts the requests not picked up and the open ones with the viewer", () => {
    expect(requestsFigure(requests, viewer)).toEqual({ value: 2, note: "4 open requests in total, 1 with you" });
    expect(requestsFigure([], viewer)).toEqual({ value: 0, note: "No open requests" });
  });

  it("makes the viewer the owner when they start on a request", () => {
    const started = markRequestStarted(requests, "new-waiting", viewer, "2026-11-26T06:30:00Z") ?? [];
    expect(started.find((item) => item.id === "new-waiting")).toMatchObject({ handledBy: { accountId: "it-ana", name: "Ana Reyes" }, handledAt: "2026-11-26T06:30:00Z" });
    const rows = requestRows(started, viewer, new Set(["new-waiting"]), now, formats);
    expect(rows.map((row) => row.id)).toEqual(["old-waiting", "new-waiting", "mine"]);
    expect(rows[1]).toMatchObject({ canStart: false, state: "started", stateLabel: "You started on it just now" });
    expect(requestsFigure(started, viewer).value).toBe(1);
    expect(markRequestStarted(undefined, "x", viewer, "")).toBeUndefined();
  });
});

describe("Connection problems", () => {
  const health = [
    place("delayed", { name: "Municipal Sports Center", app: { status: "delayed", lastDataAt: "2026-11-26T06:16:00Z" } }),
    place("offline", {
      name: "Riverside Food Park",
      app: { status: "offline", lastDataAt: "2026-11-26T01:12:00Z" },
      cameras: { total: 2, counting: 0, list: [camera("a", "stopped"), camera("b", "stopped")] },
    }),
    place("camera", {
      name: "San Antonio Lakeside Park",
      cameras: {
        total: 3,
        counting: 2,
        list: [camera("gate", "not_counting", { name: "Gate A, main entrance", note: "Losing its picture since 3:24 PM" }), camera("x", "counting"), camera("y", "counting")],
      },
    }),
    place("closed", { openNow: false, app: { status: "online", lastDataAt: "2026-11-25T10:00:00Z" }, cameras: { total: 4, counting: 0, list: [] } }),
    place("inactive", { accountState: "deactivated", app: { status: "offline", lastDataAt: null } }),
    place("new", { app: { status: "not_set_up", lastDataAt: null }, cameras: { total: 0, counting: 0, list: [] } }),
    place("fine"),
  ];
  const requests = [request({ id: "149", code: "REQ-000149", enterpriseId: "camera" }), request({ id: "150", code: "REQ-000150", enterpriseId: "camera", status: "Resolved" })];

  it("lists offline apps, then delayed ones, then cameras not counting at open active places", () => {
    const rows = connectionRows(health, requests, now, formats);
    expect(rows.map((row) => [row.enterpriseId, row.kind, row.label])).toEqual([
      ["offline", "offline", "Desktop app offline"],
      ["delayed", "delayed", "Delayed"],
      ["camera", "camera", "1 camera not counting"],
    ]);
    expect(rows[0].detail).toBe("No data since 9:12 AM. Both cameras stopped counting with it.");
    expect(rows[1].detail).toBe("Last data 14 min ago. Counts usually arrive every minute.");
    expect(rows[2]).toMatchObject({ detail: "Gate A, main entrance. Losing its picture since 3:24 PM.", requestCode: "REQ-000149", href: "/it/enterprises/camera" });
  });

  it("counts places not sending data and cameras not counting, leaving closed and inactive places out", () => {
    expect(placesFigure(health)).toEqual({ value: 2, note: "1 desktop app offline, 1 delayed" });
    expect(camerasFigure(health)).toEqual({ value: 3, note: "Of 9 cameras at 4 places" });
    expect(placesFigure([place("fine")])).toEqual({ value: 0, note: "Every open place is sending data" });
    expect(camerasFigure([place("fine")])).toEqual({ value: 0, note: "All 2 cameras at open places are counting" });
    expect(camerasFigure([])).toEqual({ value: 0, note: "No cameras at open places right now" });
  });
});

describe("Accounts waiting", () => {
  const enterprise = account("ent-1", {
    role: "enterprise",
    title: "Enterprise Account",
    enterpriseName: "Cuyab River Eco Park",
    isActivated: false,
    invitation: { sentAt: "2026-11-23T02:00:00Z", expiresAt: "2026-11-30T02:00:00Z", expired: false },
  });
  const expiredEnterprise = account("ent-2", {
    role: "enterprise",
    enterpriseName: "San Pedro Heritage Museum",
    isActivated: false,
    invitation: { sentAt: "2026-11-18T02:00:00Z", expiresAt: "2026-11-25T02:00:00Z", expired: true },
  });
  const staff = account("staff-1", { displayName: "Grace Bautista", isActivated: false, invitation: { sentAt: "2026-11-22T02:00:00Z", expiresAt: "2026-11-29T02:00:00Z", expired: false } });
  const deactivated = account("staff-2", { isActivated: false, status: "inactive" });
  const itPerson = account("it-carlo", {
    displayName: "Carlo Mendoza",
    role: "it",
    title: "IT Personnel",
    profileChangeRequests: [
      { type: "businessEmail", label: "Email", requestedValue: "carlo@new.example", requestedAt: null, requestId: "r1", status: "verified", isVerified: true, canApprove: false, expiresAt: null },
    ],
  });
  const approvable = account("staff-3", {
    displayName: "Joy Villanueva",
    profileChangeRequests: [
      { type: "businessEmail", label: "Email", requestedValue: "joy@new.example", requestedAt: null, requestId: "r2", status: "verified", isVerified: true, canApprove: true, expiresAt: null },
    ],
  });
  const unverified = account("staff-4", {
    profileChangeRequests: [
      {
        type: "businessEmail",
        label: "Email",
        requestedValue: "x@new.example",
        requestedAt: null,
        requestId: "r3",
        status: "pending_verification",
        isVerified: false,
        canApprove: false,
        expiresAt: null,
      },
    ],
  });

  it("lists invitations not accepted, newest first, then verified email changes", () => {
    const rows = accountRows([staff, deactivated, itPerson, approvable, unverified], [enterprise, expiredEnterprise], now, formats);
    expect(rows.map((row) => [row.kind, row.name, row.action.label])).toEqual([
      ["Enterprise invitation", "Cuyab River Eco Park", "Send again"],
      ["Staff invitation", "Grace Bautista", "Send again"],
      ["Enterprise invitation", "San Pedro Heritage Museum", "Send a new link"],
      ["Email change", "Carlo Mendoza, IT", "Review"],
      ["Email change", "Joy Villanueva, Staff", "Review"],
    ]);
    expect(rows[0].detail).toBe("Invited 3 days ago. The owner has not set a password yet.");
    expect(rows[1].detail).toBe("Invited as Staff on Nov 22, 2026. Not activated yet.");
    expect(rows[2].detail).toBe("The invitation link expired yesterday.");
    expect(rows[3]).toMatchObject({ detail: "Verified a new email. Another IT account has to approve it.", action: { href: "/it/personnel" } });
    expect(rows[4].detail).toBe("Verified joy@new.example. Waiting for your approval.");
  });

  it("describes what is waiting in the figure", () => {
    const rows = accountRows([staff, itPerson], [enterprise], now, formats);
    expect(accountsFigure(rows)).toEqual({ value: 3, note: "2 invitations not accepted and an email change to approve" });
    expect(accountsFigure(accountRows([staff], [], now, formats)).note).toBe("An invitation not accepted yet");
    expect(accountsFigure(accountRows([itPerson, approvable], [], now, formats)).note).toBe("2 email changes to approve");
    expect(accountsFigure([])).toEqual({ value: 0, note: "No invitations or email changes waiting" });
  });
});

describe("Emails that did not arrive", () => {
  it("names the kind of email", () => {
    expect(emailKind(email("a", { recipientRole: "Enterprise Account" }))).toBe("Enterprise invitation");
    expect(emailKind(email("a", { recipientRole: "LGU Staff" }))).toBe("Staff invitation");
    expect(emailKind(email("a"))).toBe("Invitation");
    expect(emailKind(email("a", { purpose: "password_reset" }))).toBe("Password reset");
    expect(emailKind(email("a", { purpose: "monthly_digest" }))).toBe("Monthly digest");
  });

  it("lists problem emails newest first with why they did not arrive", () => {
    const deliveries = [
      email("ok"),
      email("failed", { status: "terminal_failed", canRetry: true, failureReason: "the mailbox is full", recipientName: "San Pedro Heritage Museum", recipientRole: "Enterprise Account" }),
      email("check", { status: "reconciliation_required", createdAt: "2026-11-26T05:00:00Z" }),
      email("later", { status: "retry_scheduled", canRetry: true, nextAttemptAt: "2026-11-26T07:00:00Z", createdAt: "2026-11-20T05:00:00Z" }),
    ];
    const rows = emailRows(deliveries, noIds, now, formats);
    expect(rows.map((row) => row.id)).toEqual(["check", "failed", "later"]);
    expect(rows[0]).toMatchObject({ reason: "The mail service did not confirm that it was sent.", canRetry: false, when: "1:00 PM" });
    expect(rows[1]).toMatchObject({
      kind: "Enterprise invitation",
      when: "Yesterday, 4:05 PM",
      to: "San Pedro Heritage Museum",
      recipient: "failed@example.test",
      reason: "Not delivered: the mailbox is full.",
      tone: "problem",
      canRetry: true,
    });
    expect(rows[2].reason).toBe("Not sent yet. TANAW will try again at 3:00 PM.");
  });

  it("keeps an email IT just sent again, with a note instead of the button", () => {
    const rows = emailRows([email("failed", { status: "queued", canRetry: false })], new Set(["failed"]), now, formats);
    expect(rows).toEqual([expect.objectContaining({ id: "failed", tone: "retried", canRetry: false, reason: "Sent again just now. Waiting for the mail server." })]);
    expect(emailRows([email("failed")], new Set(["failed"]), now, formats)[0].reason).toBe("Sent again. The mail server accepted it.");
    expect(emailRows([email("ok")], noIds, now, formats)).toEqual([]);
  });
});

describe("Section rows", () => {
  it("shows the first rows and counts the rest", () => {
    expect(firstRows([1, 2, 3, 4, 5, 6, 7])).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 2 });
    expect(firstRows([1], 5)).toEqual({ shown: [1], hidden: 0 });
  });
});
