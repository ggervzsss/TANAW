import type { SystemLog, SystemLogCategory } from "@/shared/types";
import { isWithinActivityTimeRange, type ActivityTimeRange } from "@/shared/utils";
import type { BadgeTone } from "../../../design-system";

export type ActivityGroup = "All Activity" | "Reports" | "Admin Activity" | "Accounts & Settings" | "Issues & Resolutions" | "Security";

export const activityGroups: ActivityGroup[] = ["All Activity", "Reports", "Admin Activity", "Accounts & Settings", "Issues & Resolutions", "Security"];
export const defaultTypeOptions = ["All Types", "IT Activity", "Enterprise Activity", "System"];
export const defaultAccountOptions = ["All Accounts", "IT Personnel", "Enterprise Account", "System"];

export const activityGroupTones: Record<Exclude<ActivityGroup, "All Activity">, BadgeTone> = {
  Reports: "teal",
  "Admin Activity": "purple",
  "Accounts & Settings": "info",
  "Issues & Resolutions": "warning",
  Security: "danger",
};

export const systemLogTypeTones: Record<SystemLogCategory, BadgeTone> = {
  "IT Activity": "purple",
  "Staff Submission": "teal",
  "Staff Operation": "success",
  "Admin Operation": "purple",
  "Enterprise Activity": "warning",
  System: "neutral",
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
