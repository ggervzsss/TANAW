import type { MapEnterprise, MonitoringStatus, OccupancyStatus } from "@/shared/types";

export type MonitoringStatusTone = "running" | "partial" | "inactive" | "fault" | "unconfigured";

export type MonitoringStatusPresentation = {
  badgeClass: string;
  color: string;
  tone: MonitoringStatusTone;
};

const monitoringStatusPresentations: Record<MonitoringStatusTone, MonitoringStatusPresentation> = {
  running: {
    badgeClass: "border-green-200 bg-green-50 text-green-800 dark:border-green-400/25 dark:bg-green-400/10 dark:text-green-200",
    color: "#16a34a",
    tone: "running",
  },
  partial: {
    badgeClass: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/35 dark:bg-amber-400/15 dark:text-amber-200",
    color: "#9f6508",
    tone: "partial",
  },
  inactive: {
    badgeClass: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-300/35 dark:bg-sky-400/15 dark:text-sky-200",
    color: "#266993",
    tone: "inactive",
  },
  fault: {
    badgeClass: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-300/35 dark:bg-rose-400/15 dark:text-rose-200",
    color: "#ae274d",
    tone: "fault",
  },
  unconfigured: {
    badgeClass: "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-300/35 dark:bg-violet-400/15 dark:text-violet-200",
    color: "#665090",
    tone: "unconfigured",
  },
};

const legendLabels: Record<MonitoringStatusTone, string> = {
  running: "All Running",
  partial: "Partial / Delayed",
  inactive: "Stopped / Offline",
  fault: "Needs Attention",
  unconfigured: "Not Configured",
};

export const monitoringStatusLegend = Object.values(monitoringStatusPresentations).map((status) => ({ ...status, label: legendLabels[status.tone] }));

export function getMonitoringStatusLabel(status: MonitoringStatus): string {
  if (status === "Fully Monitoring") return "All Running";
  if (status === "Partially Monitoring") return "Partial";
  if (status === "Fault") return "Needs Attention";
  return status;
}

export function getMonitoringStatusPresentation(status: MonitoringStatus): MonitoringStatusPresentation {
  if (status === "Fully Monitoring") return monitoringStatusPresentations.running;
  if (status === "Partially Monitoring" || status === "Updates Delayed") return monitoringStatusPresentations.partial;
  if (status === "Fault") return monitoringStatusPresentations.fault;
  if (status === "Not Configured") return monitoringStatusPresentations.unconfigured;
  return monitoringStatusPresentations.inactive;
}

export function getMonitoringStatusColor(status: MonitoringStatus) {
  return getMonitoringStatusPresentation(status).color;
}

export function getDarkMonitoringBadgeClass(status: MonitoringStatus) {
  return getMonitoringStatusPresentation(status).badgeClass;
}

export function getOccupancyRingColor(status: OccupancyStatus) {
  if (status === "High Occupancy") return "#ef4444";
  if (status === "Warning") return "#facc15";
  return "transparent";
}

export function getOccupancyBadgeClass(status: OccupancyStatus) {
  if (status === "High Occupancy") return "border-red-200 bg-red-50 text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200";
  if (status === "Warning") return "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-400/25 dark:bg-yellow-400/10 dark:text-yellow-200";
  if (status === "Normal") return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-100";
  return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-200";
}

/**
 * What a place's pin shows right now, one state at a time: offline wins (no fresh counts), then a
 * camera that is not counting, then busier than usual. Outside opening hours, or temporarily
 * closed, the pin is faded instead of offline.
 */
export type MapPinState = "normal" | "busy" | "camera" | "offline" | "closed";

export const MAP_PIN_STATES: readonly MapPinState[] = ["normal", "busy", "camera", "offline", "closed"];

/** DESIGN.md colours: Civic Green, warning amber, danger red, neutral slate. Closed is faded green. */
export const mapPinColors: Record<MapPinState, string> = {
  normal: "#1f8a3c",
  busy: "#d97706",
  camera: "#dc2626",
  offline: "#64748b",
  closed: "#1f8a3c",
};

export const mapPinStateLabels: Record<MapPinState, string> = {
  normal: "Open and counting",
  busy: "Busier than usual",
  camera: "A camera is not counting",
  offline: "Desktop app offline",
  closed: "Closed now",
};

/** The pin state the server worked out, or one from the monitoring status for older data. */
export function getMapPinState(enterprise: Pick<MapEnterprise, "pinState" | "monitoringStatus">): MapPinState {
  if (enterprise.pinState) return enterprise.pinState;
  if (enterprise.monitoringStatus === "Fault" || enterprise.monitoringStatus === "Partially Monitoring") return "camera";
  if (enterprise.monitoringStatus === "Offline") return "offline";
  return "normal";
}

/** The small icon inside each pin, so the state never depends on colour alone. */
export const MAP_PIN_ICON_PATHS: Record<MapPinState, string> = {
  normal: "M5.5 20V7.7a1 1 0 0 1 .66-.94l5.5-2.02a1 1 0 0 1 1.34.94V20M13 9h5a1 1 0 0 1 1 1v10M3.5 20h17M8.5 9.5h1M8.5 12.5h1M8.5 15.5h1M15.5 12.5h1M15.5 15.5h1",
  busy: "M4 17l5-5 4 4 7-8M15 8h5v5",
  camera: "M3 3l18 18M10.6 6H14l2 2h3a1 1 0 0 1 1 1v8.4M17 19H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.5M9.6 10.6a3 3 0 0 0 4 4",
  offline: "M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.5M12 20h.01M14.6 10.6A10 10 0 0 1 19 12.9M2 8.8a15 15 0 0 1 4.3-2.6M10.7 5.1A15 15 0 0 1 22 8.8",
  closed: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};
