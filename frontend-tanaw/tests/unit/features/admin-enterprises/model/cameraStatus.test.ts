import { describe, expect, it } from "vitest";
import { cameraStatusOf, cameraWarning, formatSince, isSameDayAs, monitoredLocations, needsAttention } from "@/features/admin-enterprises/model/cameraStatus";
import type { CameraMonitoringCamera, MapEnterprise } from "@/shared/types";

const now = new Date(2026, 10, 24, 15, 30);
const at = (hour: number, minute = 0, day = 24) => new Date(2026, 10, day, hour, minute).toISOString();

function camera(cameraId: number, cameraName: string, status: CameraMonitoringCamera["status"], error: string | null = null): CameraMonitoringCamera {
  return { cameraId, cameraName, status, running: status === "running", error };
}

function enterprise(overrides: Partial<MapEnterprise> = {}, cameras: CameraMonitoringCamera[] = [camera(1, "Main Entrance", "running"), camera(2, "Side Entrance", "running")]): MapEnterprise {
  const healthy = cameras.filter((item) => item.status === "running").length;
  return {
    id: "ENT-1",
    name: "City Plaza",
    barangay: "Poblacion",
    category: "Parks",
    fullAddress: "Barangay Poblacion, San Pedro, Laguna",
    lat: 14.3,
    lng: 121.0,
    totalLiveOccupancy: 60,
    estimatedUniqueCount: 400,
    monitoringStatus: "Fully Monitoring",
    occupancyStatus: "Normal",
    gatewayStatus: "Connected",
    lastSync: at(15, 29),
    cameraMonitoring: {
      status: healthy === cameras.length ? "running" : "partial",
      configuredCameraCount: cameras.length,
      activeCameraCount: healthy,
      healthyCameraCount: healthy,
      startingCameraCount: cameras.filter((item) => item.status === "starting").length,
      stoppedCameraCount: cameras.filter((item) => item.status === "stopped").length,
      errorCameraCount: cameras.filter((item) => item.status === "error").length,
      cameras,
    },
    ...overrides,
  };
}

describe("camera status line", () => {
  it("reads Monitoring when every camera counts", () => {
    expect(cameraStatusOf(enterprise(), now)).toEqual({ state: "ok", label: "Monitoring", cameraCount: 2, runningCount: 2 });
  });

  it("counts cameras that are not reporting", () => {
    const status = cameraStatusOf(enterprise({}, [camera(1, "Main", "running"), camera(2, "Parking Area", "error", "Stream lost")]), now);
    expect(status).toEqual({ state: "issue", label: "1 camera not reporting", cameraCount: 2, runningCount: 1 });
    const two = cameraStatusOf(enterprise({}, [camera(1, "A", "stopped"), camera(2, "B", "starting"), camera(3, "C", "running")]), now);
    expect(two.label).toBe("2 cameras not reporting");
  });

  it("names the time of the last update when the connection is lost", () => {
    const status = cameraStatusOf(enterprise({ gatewayStatus: "Offline", monitoringStatus: "Offline", lastSync: at(14, 40) }), now);
    expect(status.state).toBe("offline");
    expect(status.label).toBe("No connection since 2:40 PM");
    expect(status.runningCount).toBe(0);
    expect(cameraStatusOf(enterprise({ gatewayStatus: "Not Linked", cameraMonitoring: null, lastSync: undefined }), now).label).toBe("No connection yet");
  });

  it("flags delayed updates and reported faults as issues", () => {
    expect(cameraStatusOf(enterprise({ gatewayStatus: "Sync Delayed", lastSync: at(15, 20) }), now).label).toBe("Updates delayed since 3:20 PM");
    expect(cameraStatusOf(enterprise({ monitoringStatus: "Fault" }), now)).toMatchObject({ state: "issue", label: "Monitoring fault reported" });
  });

  it("treats an enterprise without cameras or monitoring data apart from attention", () => {
    const none = cameraStatusOf(enterprise({ monitoringStatus: "Not Configured" }, []), now);
    expect(none).toMatchObject({ state: "unconfigured", label: "No cameras set up", cameraCount: 0 });
    expect(cameraStatusOf(undefined, now)).toMatchObject({ state: "unknown", cameraCount: null });
    expect(needsAttention("unconfigured")).toBe(false);
    expect(needsAttention("unknown")).toBe(false);
    expect(needsAttention("issue")).toBe(true);
    expect(needsAttention("offline")).toBe(true);
  });
});

describe("dates", () => {
  it("formats a last update by how long ago it was", () => {
    expect(formatSince(at(9, 5), now)).toBe("9:05 AM");
    expect(formatSince(at(9, 5, 20), now)).toBe("Nov 20, 9:05 AM");
    expect(formatSince(new Date(2025, 11, 31, 8).toISOString(), now)).toBe("Dec 31, 2025");
    expect(formatSince(undefined, now)).toBeNull();
    expect(formatSince("not a date", now)).toBeNull();
  });

  it("checks whether an update arrived today", () => {
    expect(isSameDayAs(at(0, 1), now)).toBe(true);
    expect(isSameDayAs(at(23, 59, 23), now)).toBe(false);
    expect(isSameDayAs(null, now)).toBe(false);
  });
});

describe("monitored locations", () => {
  it("lists each camera with its state and flags the ones IT should see", () => {
    const locations = monitoredLocations(enterprise({}, [camera(1, "Main Entrance", "running"), camera(2, "Gate", "starting"), camera(3, "Parking Area", "error", "Stream lost"), camera(4, " ", "stopped")]), now);
    expect(locations.map(({ name, state, label, needsIt }) => ({ name, state, label, needsIt }))).toEqual([
      { name: "Main Entrance", state: "monitoring", label: "Monitoring", needsIt: false },
      { name: "Gate", state: "starting", label: "Starting", needsIt: false },
      { name: "Parking Area", state: "failing", label: "Not responding", needsIt: true },
      { name: "Camera 4", state: "stopped", label: "Stopped", needsIt: true },
    ]);
    expect(locations[2]?.note).toBe("Stream lost");
  });

  it("marks every camera as without connection while the enterprise is offline", () => {
    const locations = monitoredLocations(enterprise({ gatewayStatus: "Offline", lastSync: at(14, 40) }), now);
    expect(locations.every((location) => location.state === "offline" && location.needsIt)).toBe(true);
    expect(locations[0]?.note).toBe("No updates since 2:40 PM.");
  });

  it("returns nothing when the desktop sent no camera list", () => {
    expect(monitoredLocations(enterprise({ cameraMonitoring: { ...enterprise().cameraMonitoring!, cameras: undefined } }), now)).toEqual([]);
    expect(monitoredLocations(undefined, now)).toEqual([]);
  });

  it("words the header warning from the failing cameras", () => {
    expect(cameraWarning(enterprise(), now)).toBeNull();
    expect(cameraWarning(enterprise({}, [camera(1, "Main", "running"), camera(2, "Parking Area", "error")]), now)).toBe("Parking Area is not responding");
    expect(cameraWarning(enterprise({}, [camera(1, "A", "error"), camera(2, "B", "stopped")]), now)).toBe("2 cameras are not responding");
  });
});
