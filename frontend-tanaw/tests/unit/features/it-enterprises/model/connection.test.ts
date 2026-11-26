import { describe, expect, it } from "vitest";
import { hoursPayload, detailsPayload } from "@/features/it-enterprises/model/accountPayload";
import {
  STRIP_LEGEND,
  appVersion,
  cameraKind,
  cameraState,
  clockLabel,
  compareVersions,
  hourLabel,
  lastDataText,
  requestStatus,
  requestWhen,
  slotRuns,
  stripIntro,
  stripSummary,
  stripTicks,
} from "@/features/it-enterprises/model/connection";
import { createEnterpriseEditForm } from "@/features/enterprise-accounts/model";
import { defaultOpeningHours } from "@/features/enterprise-accounts/model/openingHours";
import type { AccountSummary } from "@/shared/types";

// 3:51 PM on Nov 26, 2026 in Manila.
const NOW = new Date("2026-11-26T07:51:00Z");

const slots = (pattern: string, from = 6) =>
  pattern.split("").map((code, index) => ({ hour: from + index, state: ({ o: "counting", g: "gaps", d: "down", c: "closed", f: "future" } as const)[code as "o"] }));

describe("camera strip", () => {
  it("names the five states in legend order", () => {
    expect(STRIP_LEGEND.map((item) => [item.state, item.label])).toEqual([
      ["counting", "Counting"],
      ["gaps", "Dropped out at times"],
      ["down", "Not counting"],
      ["closed", "Closed"],
      ["future", "Not yet"],
    ]);
  });

  it("labels hours and clock times in both formats", () => {
    expect([0, 6, 12, 13, 18, 24].map((hour) => hourLabel(hour, "12-hour"))).toEqual(["12 AM", "6 AM", "12 PM", "1 PM", "6 PM", "12 AM"]);
    expect(hourLabel(6, "24-hour")).toBe("06:00");
    expect(hourLabel(24, "24-hour")).toBe("24:00");
    expect(clockLabel("08:30", "12-hour")).toBe("8:30 AM");
    expect(clockLabel("18:00", "12-hour")).toBe("6 PM");
    expect(clockLabel("8:05", "24-hour")).toBe("08:05");
  });

  it("introduces the strip with its span and today's hours", () => {
    const hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    expect(stripIntro({ hours, openFrom: "06:00", openTo: "18:00" }, "12-hour")).toBe("Each block is one hour, 6 AM to 6 PM. The place is open 6 AM to 6 PM today.");
    expect(stripIntro({ hours, openFrom: null, openTo: null }, "12-hour")).toBe("Each block is one hour, 6 AM to 6 PM. No opening hours are set for today.");
  });

  it("places about five ticks, both ends included", () => {
    const ticks = stripTicks([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], "12-hour");
    expect(ticks.map((tick) => tick.label)).toEqual(["6 AM", "9 AM", "12 PM", "3 PM", "6 PM"]);
    expect(ticks.map((tick) => tick.percent)).toEqual([0, 25, 50, 75, 100]);
    const odd = stripTicks([8, 9, 10, 11, 12, 13, 14], "12-hour");
    expect(odd[0].label).toBe("8 AM");
    expect(odd[odd.length - 1].label).toBe("3 PM");
    expect(stripTicks([], "12-hour")).toEqual([]);
  });

  it("groups hours into runs and reads them aloud", () => {
    expect(slotRuns(slots("ooogdff"))).toEqual([
      { state: "counting", from: 6, to: 9 },
      { state: "gaps", from: 9, to: 10 },
      { state: "down", from: 10, to: 11 },
      { state: "future", from: 11, to: 13 },
    ]);
    expect(stripSummary({ name: "Gate A", slots: slots("ooogdff") }, "12-hour")).toBe(
      "Gate A: counting 6 AM to 9 AM, dropping out at times 9 AM to 10 AM, not counting 10 AM to 11 AM, not yet 11 AM to 1 PM.",
    );
    expect(stripSummary({ name: "Gate B", slots: slots("oooo") }, "12-hour")).toBe("Gate B: counting all day so far.");
    expect(stripSummary({ name: "Deck", slots: [] }, "12-hour")).toBe("Deck: no hours to show today.");
  });
});

describe("cameras and the app", () => {
  it("describes the camera kind", () => {
    expect(cameraKind({ mode: "entrance_exit", brand: "Hikvision" })).toBe("Entry and exit · Hikvision");
    expect(cameraKind({ mode: "open_space", brand: null })).toBe("Open space");
    expect(cameraKind({ mode: null, brand: " " })).toBe("");
  });

  it("says each camera's live state", () => {
    const base = { id: "c", name: "Gate A" };
    expect(cameraState({ ...base, status: "counting" }, NOW, "MMM d, yyyy", "12-hour")).toEqual({ text: "Counting", tone: "ok" });
    expect(cameraState({ ...base, status: "not_counting", since: "2026-11-26T07:24:00Z" }, NOW, "MMM d, yyyy", "12-hour")).toEqual({ text: "Not counting since 3:24 PM", tone: "danger" });
    expect(cameraState({ ...base, status: "stopped", since: "2026-11-20T07:24:00Z" }, NOW, "MMM d, yyyy", "12-hour")).toEqual({ text: "Stopped since Nov 20, 2026", tone: "muted" });
    expect(cameraState(undefined, NOW, "MMM d, yyyy", "12-hour").text).toBe("No live status");
  });

  it("compares the app version with the latest", () => {
    expect(compareVersions("0.1.3", "0.1.3")).toBe(0);
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("v1.0", "0.9.9")).toBeGreaterThan(0);
    expect(appVersion({ version: "0.1.3", latestVersion: "0.1.3" })).toEqual({ version: "0.1.3", note: "(latest)" });
    expect(appVersion({ version: "0.1.2", latestVersion: "0.1.3" })).toEqual({ version: "0.1.2", note: "(update available)" });
    expect(appVersion({ version: null, latestVersion: "0.1.3" })).toEqual({ version: "Not reported", note: null });
  });

  it("says when the last data came", () => {
    expect(lastDataText("2026-11-26T07:50:00Z", NOW, "MMM d, yyyy", "12-hour")).toBe("1 min ago, 3:50 PM");
    expect(lastDataText("2026-11-20T07:50:00Z", NOW, "MMM d, yyyy", "12-hour")).toBe("Nov 20, 2026, 3:50 PM");
    expect(lastDataText(null, NOW, "MMM d, yyyy", "12-hour")).toBe("Never");
  });
});

describe("requests from the place", () => {
  it("says who is handling each request", () => {
    expect(requestStatus({ status: "In Progress", handledBy: null })).toEqual({ text: "Not picked up", tone: "warn" });
    expect(requestStatus({ status: "In Progress", handledBy: { accountId: "it-1", name: "Carlo Mendoza" } })).toEqual({ text: "In progress · Carlo Mendoza", tone: "ok" });
    expect(requestStatus({ status: "Resolved", handledBy: { accountId: "it-2", name: "Ana Reyes" } })).toEqual({ text: "Resolved · Ana Reyes", tone: "muted" });
  });

  it("dates each request", () => {
    expect(requestWhen("2026-11-26T07:30:00Z", NOW, "MMM d, yyyy", "12-hour")).toBe("Today, 3:30 PM");
    expect(requestWhen("2026-11-25T07:30:00Z", NOW, "MMM d, yyyy", "12-hour")).toBe("Yesterday");
    expect(requestWhen("2026-10-14T07:30:00Z", NOW, "d MMM yyyy", "12-hour")).toBe("14 Oct 2026");
  });
});

describe("save payloads", () => {
  const account: AccountSummary = {
    id: "acct-1",
    email: "office@example.test",
    phone: "+639171110003",
    firstName: null,
    lastName: null,
    enterpriseName: "Lakeside Park",
    category: "Park or open area",
    attraction: { code: "201", typeCode: "2", type: "Man-made", category: "Park or open area", portfolioCategory: "Leisure", ntdpCode: "TD201" },
    managerName: "Nora Dizon",
    barangay: "San Antonio",
    address: "Lakeside Road",
    latitude: 14.35,
    longitude: 121.03,
    locationUpdatedAt: null,
    enterpriseId: "ENT-1",
    gatewayStatus: null,
    buildingCapacity: 250,
    displayName: "Lakeside Park",
    role: "enterprise",
    title: "Enterprise Account",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-03-03T00:00:00Z",
    lastLoginAt: null,
  };

  it("saves hours with the account's other details unchanged", () => {
    const hours = defaultOpeningHours();
    expect(hoursPayload(account, hours)).toEqual({
      enterpriseName: "Lakeside Park",
      attractionCode: "201",
      attractionDescription: null,
      managerName: "Nora Dizon",
      email: "office@example.test",
      contactNumber: "+639171110003",
      barangay: "San Antonio",
      address: "Lakeside Road",
      buildingCapacity: 250,
      openingHours: hours,
    });
    expect(hoursPayload({ ...account, attraction: null }, hours)).toBeNull();
  });

  it("saves details without touching the hours, and keeps an activated owner's email", () => {
    const form = { ...createEnterpriseEditForm(account), email: "typo@example.test", buildingCapacity: "300" };
    const payload = detailsPayload(form, { latitude: 14.36, longitude: 121.04 }, account);
    expect(payload.openingHours).toBeUndefined();
    expect(payload.email).toBe("office@example.test");
    expect(payload.buildingCapacity).toBe(300);
    expect(payload.latitude).toBe(14.36);
    expect(detailsPayload(form, null, { ...account, isActivated: false }).email).toBe("typo@example.test");
  });
});
