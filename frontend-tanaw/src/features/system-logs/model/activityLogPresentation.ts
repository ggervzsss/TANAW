import type { SystemLog, SystemLogCategory } from "@/shared/types";
import { isWithinActivityTimeRange, type ActivityTimeRange } from "@/shared/utils";

export type ActivityGroup = "All Activity" | "Reports" | "Admin Activity" | "Accounts & Settings" | "Issues & Resolutions" | "Security";

export const activityGroups: ActivityGroup[] = ["All Activity", "Reports", "Admin Activity", "Accounts & Settings", "Issues & Resolutions", "Security"];
export const defaultTypeOptions = ["All Types", "IT Activity", "Enterprise Activity", "System"];
export const defaultAccountOptions = ["All Accounts", "IT Personnel", "Enterprise Account", "System"];

export const activityGroupClasses: Record<Exclude<ActivityGroup, "All Activity">, string> = {
  Reports: "border-teal-200 bg-teal-50 text-teal-700",
  "Admin Activity": "border-indigo-200 bg-indigo-50 text-indigo-700",
  "Accounts & Settings": "border-blue-200 bg-blue-50 text-blue-700",
  "Issues & Resolutions": "border-amber-200 bg-amber-50 text-amber-700",
  Security: "border-red-200 bg-red-50 text-red-700",
};

export const systemLogTypeClasses: Record<SystemLogCategory, string> = {
  "IT Activity": "bg-violet-50 text-violet-700",
  "Staff Submission": "bg-teal-50 text-teal-700",
  "Staff Operation": "bg-emerald-50 text-emerald-700",
  "Admin Operation": "bg-indigo-50 text-indigo-700",
  "Enterprise Activity": "bg-amber-50 text-amber-700",
  System: "bg-slate-100 text-slate-700",
};

export function activityGroupFor(log: SystemLog): Exclude<ActivityGroup, "All Activity"> {
  if (log.category === "Staff Submission" || log.category === "Staff Operation") return "Reports";
  if (log.category === "Admin Operation") return "Admin Activity";
  if (log.action.startsWith("Alert ") || log.action.includes("Support Request") || log.action === "Update Support Ticket Status") return "Issues & Resolutions";
  if (log.category === "System" || log.severity === "Critical") return "Security";
  return "Accounts & Settings";
}

export function filterAdminActivityLogs(logs: SystemLog[], query: string, group: ActivityGroup, timeRange: ActivityTimeRange) {
  const normalizedQuery = query.trim().toLowerCase();
  return [...logs]
    .sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
    .filter((log) => {
      const logGroup = activityGroupFor(log);
      const searchable = [log.action, log.actor, log.target, log.summary, logGroup].join(" ").toLowerCase();
      return (!normalizedQuery || searchable.includes(normalizedQuery)) && (group === "All Activity" || logGroup === group) && isWithinActivityTimeRange(log.timestamp, timeRange);
    });
}

export function filterITSystemLogs(logs: SystemLog[], filters: { account: string; query: string; showRoutine: boolean; timeRange: ActivityTimeRange; type: string }) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return logs.filter((activity) => {
    const haystack = `${activity.summary} ${activity.actor} ${activity.target} ${activity.action}`.toLowerCase();
    return (
      haystack.includes(normalizedQuery) &&
      (filters.type === "All Types" || activity.category === filters.type) &&
      (filters.account === "All Accounts" || activity.actorRole === filters.account) &&
      isWithinActivityTimeRange(activity.timestamp, filters.timeRange) &&
      (filters.showRoutine || !isRoutineActivity(activity))
    );
  });
}

export function getTypeOptions(logs: SystemLog[], accountFilter: string) {
  if (accountFilter === "All Accounts") return defaultTypeOptions;
  return ["All Types", ...Array.from(new Set(logs.filter((activity) => activity.actorRole === accountFilter).map((activity) => activity.category))).sort()];
}

export function getAccountOptions(logs: SystemLog[], typeFilter: string) {
  if (typeFilter === "All Types") return defaultAccountOptions;
  return ["All Accounts", ...Array.from(new Set(logs.filter((activity) => activity.category === typeFilter).map((activity) => activity.actorRole))).sort()];
}

export function supportTicketIdFromActivity(log: SystemLog) {
  if (!log.sourceId) return null;
  const text = [log.action, log.target, log.summary, log.sourceId].join(" ").toLowerCase();
  return text.includes("ticket") || text.includes("tck-") ? log.sourceId : null;
}

export function getAdminActivityMetrics(logs: SystemLog[]) {
  return {
    adminCount: logs.filter((log) => activityGroupFor(log) === "Admin Activity").length,
    importantCount: logs.filter((log) => ["Issues & Resolutions", "Security"].includes(activityGroupFor(log))).length,
    reportCount: logs.filter((log) => activityGroupFor(log) === "Reports").length,
    todayCount: logs.filter((log) => isWithinActivityTimeRange(log.timestamp, "Today")).length,
  };
}

function isRoutineActivity(activity: SystemLog) {
  return ["Login", "Logout", "Submit Enterprise Report", "Generate Final Report"].includes(activity.action);
}

function timestampValue(timestamp: string) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}
