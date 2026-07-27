import type { MonitoringStatus, OccupancyStatus } from "@/shared/types";

export function getMonitoringStatusColor(status: MonitoringStatus) {
  if (status === "Fully Monitoring") return "#16a34a";
  if (status === "Partially Monitoring" || status === "Updates Delayed") return "#ea580c";
  if (status === "Fault") return "#dc2626";
  return "#64748b";
}

export function getDarkMonitoringBadgeClass(status: MonitoringStatus) {
  if (status === "Fully Monitoring") return "border-green-500/30 bg-green-900/40 text-[#8affb0]";
  if (status === "Partially Monitoring" || status === "Updates Delayed") return "border-orange-500/30 bg-orange-900/40 text-[#ffb08a]";
  if (status === "Fault") return "border-red-500/30 bg-red-900/40 text-[#ff8a8a]";
  return "border-slate-400/25 bg-slate-900/45 text-slate-200";
}

export function getOccupancyRingColor(status: OccupancyStatus) {
  if (status === "High Occupancy") return "#ef4444";
  if (status === "Warning") return "#facc15";
  return "transparent";
}

export function getOccupancyBadgeClass(status: OccupancyStatus) {
  if (status === "High Occupancy") return "border-red-500/30 bg-red-900/40 text-[#ff8a8a]";
  if (status === "Warning") return "border-yellow-500/30 bg-yellow-900/40 text-[#fde047]";
  if (status === "Normal") return "border-sky-500/25 bg-sky-900/30 text-sky-100";
  return "border-slate-400/25 bg-slate-900/45 text-slate-200";
}
