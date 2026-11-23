import type { MonitoringStatus, OccupancyStatus } from "@/shared/types";

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

/** The three pin states the dashboard map shows. */
export type MapPinState = "ok" | "partial" | "offline";

export const mapPinColors: Record<MapPinState, string> = {
  ok: "#1f8a3c",
  partial: "#b45309",
  offline: "#2c5d8f",
};

export const mapPinStateLabels: Record<MapPinState, string> = {
  ok: "All cameras running",
  partial: "Some cameras need attention",
  offline: "Not reporting",
};

/**
 * Pin colour by monitoring state: every camera running, some cameras down or delayed, or the
 * enterprise is not reporting at all (stopped, offline or no cameras set up).
 */
export function getMapPinState(status: MonitoringStatus): MapPinState {
  if (status === "Fully Monitoring") return "ok";
  if (status === "Partially Monitoring" || status === "Updates Delayed" || status === "Fault") return "partial";
  return "offline";
}
