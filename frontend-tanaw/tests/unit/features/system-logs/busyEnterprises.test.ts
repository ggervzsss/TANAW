import { describe, expect, it } from "vitest";
import { busyEnterpriseAlerts, busyPinnedLabel, pinnedBusyAlerts, pinnedForPage, rangeIncludes } from "../../../../src/features/system-logs/model/busyEnterprises";
import type { LiveAlert } from "../../../../src/shared/types";

function alert(overrides: Partial<LiveAlert> & Pick<LiveAlert, "id">): LiveAlert {
  return {
    type: "Busier Than Usual",
    severity: "Warning",
    status: "Active",
    enterpriseId: `ENT-${overrides.id}`,
    enterpriseName: "San Antonio Plaza",
    camera: null,
    summary: "San Antonio Plaza has 60 visitors inside, more than its usual 43 around this time.",
    detail: null,
    startedAt: "2026-11-28T02:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

const plaza = alert({ id: "plaza", startedAt: "2026-11-28T02:00:00.000Z" });
const mall = alert({ id: "mall", enterpriseName: "Pacita Complex Mall", startedAt: "2026-11-28T03:30:00.000Z", summary: "Pacita Complex Mall has 210 visitors inside, more than its usual 120 around this time." });
const camera = alert({ id: "camera", type: "Camera Not Counting", severity: "Critical", enterpriseName: "Municipal Sports Center", camera: "Gate A" });
const november = { start: "2026-11-01", end: "2026-11-30" };
const today = "2026-11-28";

describe("Busy places right now", () => {
  it("keeps only the active busier-than-usual alerts, one per place, the most recently busy first", () => {
    const ended = alert({ id: "ended", enterpriseName: "Casa San Pedro", status: "Ended", endedAt: "2026-11-28T04:00:00.000Z" });
    const plazaAgain = alert({ id: "plaza-again", enterpriseId: plaza.enterpriseId, startedAt: "2026-11-28T01:00:00.000Z" });
    expect(busyEnterpriseAlerts([plaza, camera, ended, mall, plazaAgain]).map((item) => item.id)).toEqual(["mall", "plaza"]);
  });

  it("puts a place at twice its usual or more (Critical) first", () => {
    const critical = alert({ id: "critical", enterpriseName: "Laguna Lakeside Resort", severity: "Critical", startedAt: "2026-11-28T00:30:00.000Z" });
    expect(busyEnterpriseAlerts([plaza, mall, critical]).map((item) => item.id)).toEqual(["critical", "mall", "plaza"]);
  });

  it("drops a pinned row as soon as its alert ends", () => {
    expect(busyEnterpriseAlerts([plaza, mall])).toHaveLength(2);
    expect(busyEnterpriseAlerts([plaza, { ...mall, status: "Ended", endedAt: "2026-11-28T05:00:00.000Z" }]).map((item) => item.id)).toEqual(["plaza"]);
  });
});

describe("Pinned rows and the filters", () => {
  it("pins under All Activity and Busiest Enterprises only", () => {
    expect(pinnedBusyAlerts([plaza, mall, camera], { type: "all", query: "", range: november }, today).map((item) => item.id)).toEqual(["mall", "plaza"]);
    expect(pinnedBusyAlerts([plaza, mall, camera], { type: "busy", query: "", range: november }, today)).toHaveLength(2);
    expect(pinnedBusyAlerts([plaza, mall], { type: "monitoring", query: "", range: november }, today)).toEqual([]);
    expect(pinnedBusyAlerts([plaza, mall], { type: "reports", query: "", range: november }, today)).toEqual([]);
  });

  it("matches the search against the enterprise name", () => {
    expect(pinnedBusyAlerts([plaza, mall], { type: "all", query: "  pacita ", range: november }, today).map((item) => item.id)).toEqual(["mall"]);
    expect(pinnedBusyAlerts([plaza, mall], { type: "all", query: "visitors", range: november }, today)).toEqual([]);
  });

  it("shows them only while the chosen range includes today", () => {
    expect(pinnedBusyAlerts([plaza], { type: "all", query: "", range: { start: "2026-11-28", end: "2026-11-28" } }, today)).toHaveLength(1);
    expect(pinnedBusyAlerts([plaza], { type: "all", query: "", range: { start: "2026-10-01", end: "2026-10-31" } }, today)).toEqual([]);
    expect(rangeIncludes(november, "")).toBe(false);
  });

  it("pins them on the first page only", () => {
    expect(pinnedForPage([plaza, mall], 1)).toHaveLength(2);
    expect(pinnedForPage([plaza, mall], 2)).toEqual([]);
  });

  it("names how many are pinned for the summary line", () => {
    expect(busyPinnedLabel(0)).toBeNull();
    expect(busyPinnedLabel(1)).toBe("1 busy enterprise pinned");
    expect(busyPinnedLabel(2)).toBe("2 busy enterprises pinned");
  });
});
