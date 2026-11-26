import { describe, expect, it } from "vitest";
import {
  accessText,
  accountCell,
  accountStateOf,
  appCell,
  appsNote,
  cameraCell,
  camerasNote,
  chipCounts,
  dayWords,
  filterRows,
  joinEnterprises,
  matchesSearch,
  needsAttention,
  parseChip,
  placeLine,
  registeredNote,
  resendLabel,
  statusLine,
  summarizeEnterprises,
  timeAgo,
  type DisplayFormats,
  type EnterpriseAccount,
  type EnterpriseRow,
} from "@/features/it-enterprises/model/enterprises";
import { manageEnterprisePath, parseManageTab, requestPath } from "@/features/it-enterprises/model/paths";
import type { EnterpriseHealth } from "@/shared/services/enterpriseHealth";

// 3:51 PM on Nov 26, 2026 in Manila.
const NOW = new Date("2026-11-26T07:51:00Z");
const formats: DisplayFormats = { now: NOW, dateFormat: "MMM d, yyyy", timeFormat: "12-hour" };
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function account(id: string, overrides: Partial<EnterpriseAccount> = {}): EnterpriseAccount {
  return {
    id,
    email: `${id}@example.test`,
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: `Place ${id}`,
    category: "Parks",
    attraction: { code: "201", typeCode: "2", type: "Man-made", category: "Park or open area", portfolioCategory: "Leisure", ntdpCode: "TD201" },
    managerName: "Nora Dizon",
    barangay: "San Antonio",
    address: "Lakeside Road",
    latitude: 14.35,
    longitude: 121.03,
    locationUpdatedAt: null,
    enterpriseId: `ENT-${id}`,
    gatewayStatus: null,
    buildingCapacity: 100,
    displayName: `Place ${id}`,
    role: "enterprise",
    title: "Enterprise Account",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-03-03T00:00:00Z",
    lastLoginAt: null,
    invitation: null,
    deactivatedAt: null,
    deactivatedByName: null,
    ...overrides,
  };
}

function health(accountId: string, overrides: Partial<EnterpriseHealth> = {}, app: Partial<EnterpriseHealth["app"]> = {}, cameras: Partial<EnterpriseHealth["cameras"]> = {}): EnterpriseHealth {
  return {
    accountId,
    enterpriseId: `ENT-${accountId}`,
    name: `Place ${accountId}`,
    barangay: "San Antonio",
    category: "Park or open area",
    accountState: "active",
    app: { status: "online", lastDataAt: minutesAgo(1), version: "0.1.3", latestVersion: "0.1.3", computerName: "Office PC", ...app },
    openNow: true,
    closedReason: null,
    cameras: { total: 2, counting: 2, list: [], ...cameras },
    ...overrides,
  };
}

function row(accountOverrides: Partial<EnterpriseAccount> = {}, healthItem: EnterpriseHealth | null = null): EnterpriseRow {
  const item = account("x", accountOverrides);
  return joinEnterprises([item], healthItem ? [healthItem] : [])[0];
}

const invitation = (sentDaysAgo: number, expired = false) => ({
  sentAt: new Date(NOW.getTime() - sentDaysAgo * 86_400_000).toISOString(),
  expiresAt: new Date(NOW.getTime() - (sentDaysAgo - 1) * 86_400_000).toISOString(),
  expired,
});

describe("account state", () => {
  it("reads deactivated, active, invited and expired from the account", () => {
    expect(accountStateOf(account("a", { status: "inactive" }))).toBe("deactivated");
    expect(accountStateOf(account("a"))).toBe("active");
    expect(accountStateOf(account("a", { isActivated: false, invitation: invitation(1) }))).toBe("invited");
    expect(accountStateOf(account("a", { isActivated: false, invitation: invitation(3, true) }))).toBe("expired");
  });

  it("falls back to the health state, then to expired, when no invitation is listed", () => {
    expect(accountStateOf(account("a", { isActivated: false }), health("a", { accountState: "invited" }))).toBe("invited");
    expect(accountStateOf(account("a", { isActivated: false }))).toBe("expired");
  });
});

describe("joinEnterprises", () => {
  it("joins health by account ID and sorts by name", () => {
    const rows = joinEnterprises([account("b", { enterpriseName: "Zoo" }), account("a", { enterpriseName: "Aqua park" })], [health("b"), health("other")]);
    expect(rows.map((item) => item.name)).toEqual(["Aqua park", "Zoo"]);
    expect(rows[0].health).toBeNull();
    expect(rows[1].health?.accountId).toBe("b");
    expect(rows[1].enterpriseId).toBe("ENT-b");
    expect(placeLine(rows[1])).toBe("Park or open area · Brgy. San Antonio");
  });

  it("links by account ID when there is no enterprise ID yet", () => {
    expect(joinEnterprises([account("a", { enterpriseId: null })], [])[0].enterpriseId).toBe("a");
  });
});

describe("chips and search", () => {
  const rows = joinEnterprises(
    [
      account("ok", { enterpriseName: "Casa San Pedro", barangay: "Poblacion" }),
      account("late"),
      account("cam"),
      account("closed"),
      account("invited", { isActivated: false, invitation: invitation(2) }),
      account("expired", { isActivated: false, invitation: invitation(9, true) }),
      account("off", { status: "inactive" }),
    ],
    [
      health("ok"),
      health("late", {}, { status: "delayed", lastDataAt: minutesAgo(14) }),
      health("cam", {}, {}, { total: 4, counting: 3, list: [{ id: "c1", name: "Gate A", status: "not_counting", note: "Gate A losing its picture" }] }),
      health("closed", { openNow: false, closedReason: "Closed for the holiday" }, {}, { total: 2, counting: 0 }),
      health("invited", { accountState: "invited" }, { status: "not_set_up", lastDataAt: null }, { total: 0, counting: 0 }),
    ],
  );

  it("counts each chip", () => {
    expect(chipCounts(rows)).toEqual({ all: 7, attention: 2, pending: 2, sending: 2 });
  });

  it("never flags a closed place, an invited account or a deactivated one", () => {
    expect(rows.filter(needsAttention).map((item) => item.id)).toEqual(["cam", "late"]);
  });

  it("filters by chip and by name, barangay or owner email", () => {
    expect(filterRows(rows, "pending", "").map((item) => item.id)).toEqual(["expired", "invited"]);
    expect(filterRows(rows, "all", "poblacion").map((item) => item.id)).toEqual(["ok"]);
    expect(filterRows(rows, "all", "late@example").map((item) => item.id)).toEqual(["late"]);
    expect(filterRows(rows, "attention", "casa")).toEqual([]);
    expect(matchesSearch(rows[0], "   ")).toBe(true);
  });

  it("reads an unknown chip as All", () => {
    expect(parseChip("attention")).toBe("attention");
    expect(parseChip("nonsense")).toBe("all");
    expect(parseChip(null)).toBe("all");
  });

  it("sums the three figures", () => {
    const figures = summarizeEnterprises(rows);
    expect(figures).toMatchObject({ total: 7, active: 4, waiting: 2, deactivated: 1, appsTotal: 4, appsSending: 3, delayed: 1, offline: 0, notSetUp: 0 });
    // The closed place's cameras are not expected to count.
    expect(figures).toMatchObject({ camerasTotal: 8, camerasCounting: 7, placesNotCounting: 1 });
    expect(registeredNote(figures)).toBe("4 active, 2 waiting for the owner to sign in, 1 deactivated");
    expect(appsNote(figures)).toBe("1 delayed");
    expect(camerasNote(figures)).toBe("1 not counting at 1 place");
  });

  it("says when everything is fine or empty", () => {
    expect(appsNote(summarizeEnterprises([]))).toBe("No active enterprises yet");
    expect(registeredNote(summarizeEnterprises([]))).toBe("No enterprises registered yet");
    expect(camerasNote(summarizeEnterprises(rows.filter((item) => item.id === "ok")))).toBe("All counting");
  });
});

describe("table cells", () => {
  it("labels the account", () => {
    expect(accountCell(row(), formats)).toEqual({ label: "Active", tone: "ok", sub: "x@example.test" });
    expect(accountCell(row({ isActivated: false, invitation: invitation(3) }), formats)).toEqual({ label: "Invitation sent", tone: "ink", sub: "3 days ago, not accepted yet" });
    expect(accountCell(row({ isActivated: false, invitation: invitation(2, true) }), formats)).toEqual({ label: "Invitation expired", tone: "warn", sub: "The link expired yesterday" });
    expect(accountCell(row({ status: "inactive", deactivatedAt: minutesAgo(30), deactivatedByName: "Ana Reyes" }), formats)).toEqual({
      label: "Deactivated",
      tone: "muted",
      sub: "Today by Ana Reyes",
    });
  });

  it("offers the right invitation action", () => {
    expect(resendLabel(row({ isActivated: false, invitation: invitation(1) }))).toBe("Send again");
    expect(resendLabel(row({ isActivated: false, invitation: invitation(5, true) }))).toBe("Send a new link");
    expect(resendLabel(row())).toBeNull();
  });

  it("labels the desktop app", () => {
    expect(appCell(row({}, health("x")), formats)).toEqual({ label: "Online", tone: "ok", sub: "Last data 1 min ago" });
    expect(appCell(row({}, health("x", {}, { status: "delayed", lastDataAt: minutesAgo(14) })), formats)).toEqual({ label: "Delayed", tone: "warn", sub: "Last data 14 min ago" });
    expect(appCell(row({}, health("x", {}, { status: "offline", lastDataAt: "2026-11-26T01:12:00Z" })), formats)).toEqual({ label: "Offline", tone: "danger", sub: "No data since 9:12 AM" });
    expect(appCell(row({}, health("x", {}, { status: "not_set_up", lastDataAt: null })), formats).label).toBe("Not set up yet");
    expect(appCell(row({}, health("x", { openNow: false, closedReason: "Closed on Sundays" })), formats)).toEqual({ label: "Closed", tone: "muted", sub: "Closed on Sundays" });
    expect(appCell(row({ isActivated: false, invitation: invitation(1) }), formats)).toEqual({ label: "Not set up yet", tone: "muted", sub: "Waiting for the owner to sign in" });
    expect(appCell(row({ status: "inactive" }, health("x")), formats).label).toBe("Signed out");
  });

  it("labels the cameras", () => {
    expect(cameraCell(row())).toMatchObject({ label: "No cameras yet" });
    expect(cameraCell(row({}, health("x")))).toEqual({ label: "2 of 2 counting", tone: "ink", sub: "" });
    expect(cameraCell(row({}, health("x", {}, {}, { total: 4, counting: 3, list: [{ id: "c", name: "Gate A", status: "not_counting", note: "Gate A losing its picture" }] })))).toEqual({
      label: "3 of 4 counting",
      tone: "warn",
      sub: "Gate A losing its picture",
    });
    expect(cameraCell(row({}, health("x", {}, { status: "offline" }, { counting: 0 })))).toMatchObject({ tone: "warn", sub: "Stopped with the desktop app" });
    expect(cameraCell(row({}, health("x", { openNow: false }, {}, { counting: 0 })))).toMatchObject({ tone: "muted", sub: "Not expected while closed" });
  });
});

describe("Manage an enterprise", () => {
  it("writes the status line", () => {
    expect(statusLine(row({}, health("x")))).toEqual({ text: "All 2 cameras counting", tone: "ok" });
    expect(statusLine(row({}, health("x", {}, {}, { total: 4, counting: 3 })))).toEqual({ text: "1 of 4 cameras not counting", tone: "warn" });
    expect(statusLine(row({}, health("x", {}, { status: "offline" })))).toEqual({ text: "Desktop app offline", tone: "danger" });
    expect(statusLine(row({}, health("x", { openNow: false, closedReason: "Holiday" })))).toEqual({ text: "Closed now: Holiday", tone: "muted" });
    expect(statusLine(row({ status: "inactive" }))).toMatchObject({ tone: "muted" });
    expect(statusLine(row({ isActivated: false, invitation: invitation(1) })).text).toBe("Waiting for the owner to sign in");
  });

  it("describes access", () => {
    expect(accessText(row(), formats)).toEqual({ text: "Active, can sign in", tone: "ok" });
    expect(accessText(row({ isActivated: false, invitation: invitation(1, true) }), formats).text).toBe("Invitation expired");
  });

  it("builds links and reads the tab", () => {
    expect(manageEnterprisePath("lolo_uwenger_001@tanaw.sanpedro")).toBe("/it/enterprises/lolo_uwenger_001%40tanaw.sanpedro");
    expect(manageEnterprisePath("ENT-1", "hours")).toBe("/it/enterprises/ENT-1?tab=hours");
    expect(manageEnterprisePath("ENT-1", "connection")).toBe("/it/enterprises/ENT-1");
    expect(requestPath("request-1")).toBe("/it/requests?request=request-1");
    expect(parseManageTab("details")).toBe("details");
    expect(parseManageTab("other")).toBe("connection");
  });
});

describe("time words", () => {
  it("says how long ago", () => {
    expect(timeAgo(minutesAgo(0), NOW)).toBe("just now");
    expect(timeAgo(minutesAgo(5), NOW)).toBe("5 min ago");
    expect(timeAgo(minutesAgo(180), NOW)).toBe("3 hr ago");
    expect(timeAgo(minutesAgo(60 * 49), NOW)).toBe("2 days ago");
    expect(timeAgo(null, NOW)).toBe("");
  });

  it("counts calendar days in Manila", () => {
    // 11:30 PM Manila the day before is yesterday, though under a day ago.
    expect(dayWords("2026-11-25T15:30:00Z", NOW, "MMM d, yyyy")).toBe("yesterday");
    expect(dayWords("2026-11-26T00:30:00Z", NOW, "MMM d, yyyy")).toBe("today");
    expect(dayWords("2026-11-01T00:30:00Z", NOW, "MMM d, yyyy")).toBe("on Nov 1, 2026");
  });
});
