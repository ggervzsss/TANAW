import type { EnterpriseStatus } from "@/shared/types";

export function getDarkStatusBadgeClass(status: EnterpriseStatus | "No Data") {
  if (status === "Critical") return "border-red-500/30 bg-red-900/40 text-[#ff8a8a]";
  if (status === "Warning") return "border-orange-500/30 bg-orange-900/40 text-[#ffb08a]";
  if (status === "Normal") return "border-green-500/30 bg-green-900/40 text-[#8affb0]";
  return "border-slate-400/25 bg-slate-900/45 text-slate-200";
}
