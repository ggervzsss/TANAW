import type { CameraMonitoringCamera, MapEnterprise } from "@/shared/types";

/*
 * Camera status of one enterprise, from the latest desktop update on /operational/map-enterprises.
 *
 *   ok            connected and every configured camera is counting ("Monitoring").
 *   issue         connected, but a camera is not counting, updates are delayed, or a fault was reported.
 *   offline       no connection: the desktop stopped sending updates or never sent one.
 *   unconfigured  connected, but no camera is set up on the desktop.
 *   unknown       the enterprise is registered but not on the monitoring list (no map location yet).
 *
 * "Needs attention" means issue or offline.
 */
export type CameraState = "ok" | "issue" | "offline" | "unconfigured" | "unknown";

export type CameraStatus = {
  state: CameraState;
  /** The status line under the camera count, such as "1 camera not reporting". */
  label: string;
  /** Cameras configured on the desktop, when known. */
  cameraCount: number | null;
  /** Cameras counting right now (0 while offline). */
  runningCount: number;
};

const OFFLINE_GATEWAYS = new Set<MapEnterprise["gatewayStatus"]>(["Offline", "Not Linked", "Closed"]);

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Whether a timestamp falls on the same calendar day as `now`. */
export function isSameDayAs(value: string | undefined | null, now: Date) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && sameDay(date, now);
}

/** "2:40 PM" today, "Nov 20, 2:40 PM" on another day of this year, "Nov 20, 2025" before that. */
export function formatSince(value: string | undefined | null, now: Date) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return time;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (date.getFullYear() === now.getFullYear()) return `${day}, ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function isOffline(enterprise: Pick<MapEnterprise, "gatewayStatus" | "monitoringStatus" | "cameraMonitoring">) {
  return OFFLINE_GATEWAYS.has(enterprise.gatewayStatus) || enterprise.monitoringStatus === "Offline" || enterprise.cameraMonitoring === null;
}

export function cameraStatusOf(enterprise: MapEnterprise | undefined, now: Date): CameraStatus {
  if (!enterprise) return { state: "unknown", label: "Camera status unavailable", cameraCount: null, runningCount: 0 };

  const monitoring = enterprise.cameraMonitoring;
  const cameraCount = monitoring ? monitoring.configuredCameraCount : null;
  const since = formatSince(enterprise.lastSync, now);

  if (isOffline(enterprise)) {
    return { state: "offline", label: since ? `No connection since ${since}` : "No connection yet", cameraCount, runningCount: 0 };
  }
  if (!monitoring || monitoring.status === "not_configured" || monitoring.configuredCameraCount === 0) {
    return { state: "unconfigured", label: "No cameras set up", cameraCount: 0, runningCount: 0 };
  }

  const runningCount = Math.min(monitoring.healthyCameraCount, monitoring.configuredCameraCount);
  const notReporting = monitoring.configuredCameraCount - runningCount;
  if (notReporting > 0) return { state: "issue", label: `${plural(notReporting, "camera")} not reporting`, cameraCount, runningCount };
  if (enterprise.gatewayStatus === "Sync Delayed") {
    return { state: "issue", label: since ? `Updates delayed since ${since}` : "Updates delayed", cameraCount, runningCount };
  }
  if (enterprise.monitoringStatus === "Fault") return { state: "issue", label: "Monitoring fault reported", cameraCount, runningCount };
  return { state: "ok", label: "Monitoring", cameraCount, runningCount };
}

export function needsAttention(state: CameraState) {
  return state === "issue" || state === "offline";
}

/* Monitored locations (one row per camera) on Enterprise Details. */

export type LocationState = "monitoring" | "starting" | "stopped" | "failing" | "offline";

export type MonitoredLocation = {
  id: string;
  name: string;
  state: LocationState;
  label: string;
  /** A short explanation under a camera that is not counting. */
  note: string | null;
  /** A camera IT should look at; shows the "Message IT" link. */
  needsIt: boolean;
};

export function monitoredLocations(enterprise: MapEnterprise | undefined, now: Date): MonitoredLocation[] {
  const cameras: CameraMonitoringCamera[] = enterprise?.cameraMonitoring?.cameras ?? [];
  if (!enterprise) return [];
  const offline = isOffline(enterprise);
  const since = formatSince(enterprise.lastSync, now);
  return cameras.map((camera) => {
    const id = String(camera.cameraId);
    const name = camera.cameraName.trim() || `Camera ${id}`;
    if (offline) {
      return { id, name, state: "offline", label: "No connection", note: since ? `No updates since ${since}.` : "No updates received yet.", needsIt: true };
    }
    if (camera.status === "running") return { id, name, state: "monitoring", label: "Monitoring", note: null, needsIt: false };
    if (camera.status === "starting") return { id, name, state: "starting", label: "Starting", note: "Connecting to the camera.", needsIt: false };
    if (camera.status === "stopped") return { id, name, state: "stopped", label: "Stopped", note: "Counting is stopped on the enterprise desktop.", needsIt: true };
    return { id, name, state: "failing", label: "Not responding", note: camera.error?.trim() || "The camera is not sending counts.", needsIt: true };
  });
}

/** "1 camera is not responding" for the header tag, or null when every camera is fine. */
export function cameraWarning(enterprise: MapEnterprise | undefined, now: Date) {
  const status = cameraStatusOf(enterprise, now);
  if (status.state !== "issue") return null;
  const locations = monitoredLocations(enterprise, now).filter((location) => location.state === "failing" || location.state === "stopped");
  if (locations.length === 1) return `${locations[0].name} is not responding`;
  if (locations.length > 1) return `${locations.length} cameras are not responding`;
  return status.label;
}
