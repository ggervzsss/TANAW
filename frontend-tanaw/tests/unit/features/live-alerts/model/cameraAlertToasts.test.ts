import { describe, expect, it } from "vitest";
import {
  cameraAlertToastId,
  diffCameraAlerts,
  moreCameraAlertsLabel,
  parseAnnounced,
  rememberAnnounced,
} from "../../../../../src/features/live-alerts/model/cameraAlertToasts";
import { alertKindLabel, alertMapPath, alertPlace } from "../../../../../src/features/live-alerts/model/liveAlerts";
import type { LiveAlert } from "../../../../../src/shared/types";

function alert(overrides: Partial<LiveAlert> & Pick<LiveAlert, "id">): LiveAlert {
  return {
    type: "Camera Not Counting",
    severity: "Critical",
    status: "Active",
    enterpriseId: "ENT-001",
    enterpriseName: "Sampaguita Gardens",
    camera: "Gate A",
    summary: "Gate A has not counted anyone for 10 minutes.",
    startedAt: "2026-11-23T07:15:00Z",
    ...overrides,
  };
}

const gateA = alert({ id: "gate-a" });
const gateB = alert({ id: "gate-b", camera: "Gate B" });
const busy = alert({ id: "busy", type: "Busier Than Usual", severity: "Warning", camera: null });

describe("camera alert pop-ups", () => {
  it("stays quiet on the first load and learns what is already there", () => {
    const first = diffCameraAlerts(null, [gateA, busy]);
    expect(first.announce).toEqual([]);
    expect([...first.known]).toEqual(["gate-a", "busy"]);
  });

  it("pops up a camera alert that appears afterwards", () => {
    const { known } = diffCameraAlerts(null, [gateA]);
    const next = diffCameraAlerts(known, [gateB, gateA]);
    expect(next.announce.map((item) => item.id)).toEqual(["gate-b"]);
    expect(next.known.has("gate-b")).toBe(true);
    expect(diffCameraAlerts(next.known, [gateB, gateA]).announce).toEqual([]);
  });

  it("never pops up a busy-place alert", () => {
    const { known } = diffCameraAlerts(null, []);
    expect(diffCameraAlerts(known, [busy]).announce).toEqual([]);
  });

  it("does not pop up an alert again when it ends and comes back", () => {
    const loaded = diffCameraAlerts(null, [gateA]);
    const ended = diffCameraAlerts(loaded.known, []);
    expect(diffCameraAlerts(ended.known, [gateA]).announce).toEqual([]);
  });

  it("skips alerts this tab announced before a reload", () => {
    const { known } = diffCameraAlerts(null, [], new Set(["gate-b"]));
    expect(diffCameraAlerts(known, [gateA, gateB], new Set(["gate-b"])).announce.map((item) => item.id)).toEqual(["gate-a"]);
  });

  it("builds the toast from the alert", () => {
    expect(cameraAlertToastId(gateA)).toBe("camera-alert:gate-a");
    expect(`${alertKindLabel(gateA)}: ${alertPlace(gateA)}`).toBe("Camera not counting: Sampaguita Gardens · Gate A");
    expect(alertMapPath(gateA, "/admin/dashboard")).toBe("/admin/dashboard?place=ENT-001");
    expect(moreCameraAlertsLabel(1)).toBe("1 more camera is not counting.");
    expect(moreCameraAlertsLabel(4)).toBe("4 more cameras are not counting.");
  });

  it("remembers the newest announced IDs and reads them back safely", () => {
    expect(rememberAnnounced(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(rememberAnnounced(Array.from({ length: 200 }, (_, index) => `old-${index}`), ["new"])).toHaveLength(200);
    expect(rememberAnnounced(Array.from({ length: 200 }, (_, index) => `old-${index}`), ["new"]).at(-1)).toBe("new");
    expect(parseAnnounced(JSON.stringify(["a", 1, "b"]))).toEqual(["a", "b"]);
    expect(parseAnnounced("not json")).toEqual([]);
    expect(parseAnnounced(null)).toEqual([]);
  });
});
