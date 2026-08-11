import type { MonitoringStatus, OccupancyStatus } from "@/shared/types";

export function getMonitoringStatusColor(status: MonitoringStatus) {
  if (status === "Fully Monitoring") return "#16a34a";
  if (status === "Partially Monitoring" || status === "Updates Delayed") return "#ea580c";
  if (status === "Fault") return "#dc2626";
  return "#64748b";
}

export function getDarkMonitoringBadgeClass(status: MonitoringStatus) {
  if (status === "Fully Monitoring") return "border-green-200 bg-green-50 text-green-800 dark:border-green-400/25 dark:bg-green-400/10 dark:text-green-200";
  if (status === "Partially Monitoring" || status === "Updates Delayed") return "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-200";
  if (status === "Fault") return "border-red-200 bg-red-50 text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200";
  return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-200";
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
