import type { MonitoringStatus, OccupancyStatus } from "@/shared/types";

export type MonitoringStatusTone = "running" | "partial" | "stopped" | "fault";

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
    badgeClass: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-200",
    color: "#ea580c",
    tone: "partial",
  },
  stopped: {
    badgeClass: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-200",
    color: "#64748b",
    tone: "stopped",
  },
  fault: {
    badgeClass: "border-red-200 bg-red-50 text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200",
    color: "#dc2626",
    tone: "fault",
  },
};

export const monitoringStatusLegend: { label: string; tone: MonitoringStatusTone }[] = [
  { label: "All Running", tone: "running" },
  { label: "Partial", tone: "partial" },
  { label: "Stopped", tone: "stopped" },
  { label: "Fault", tone: "fault" },
];

export function getMonitoringStatusPresentation(status: MonitoringStatus): MonitoringStatusPresentation {
  if (status === "Fully Monitoring") return monitoringStatusPresentations.running;
  if (status === "Partially Monitoring" || status === "Updates Delayed") return monitoringStatusPresentations.partial;
  if (status === "Fault") return monitoringStatusPresentations.fault;
  return monitoringStatusPresentations.stopped;
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
