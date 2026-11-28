import { adminEnterpriseDetailsPath, routes } from "@/app/routers/routes";
import { MONTH_NAMES, reviewStatus, reviewTone } from "@/features/reports/model/reportStatuses";
import type { ActivityGroup, SystemLog, SystemLogActorRole } from "@/shared/types";
import type { DateRange, RecordStatusTone } from "@/shared/ui-kit";
import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * Activity: a record of everything every user did, and everything TANAW did by itself, once
 * per event. The Admin and IT read the same records, in seven groups, newest first. The Admin
 * reads the plain summary; IT also gets the technical details (`itDetail`) the backend sends
 * only to IT. No record is pinned: open problems are on the Requests page and in Alerts. The
 * Admin page pins one row above the records for each place that is busier than usual right now
 * (busyEnterprises.ts); those rows come from the live alerts and are not records.
 */

export type ActivityKind = "security" | "accounts" | "enterprises" | "reports" | "requests" | "monitoring" | "settings";
/** `busy` is Busiest Enterprises: the busy places pinned now, and the Monitoring records about busy places. */
export type ActivityTypeFilter = "all" | ActivityKind | "busy";

export const ACTIVITY_PAGE_SIZE = 8;

/** The query parameter that holds the activity open in the drawer: `?activity=<log id>`. */
export const ACTIVITY_PARAM = "activity";

const KIND_BY_GROUP: Record<ActivityGroup, ActivityKind> = {
  "Login & Security": "security",
  Accounts: "accounts",
  Enterprises: "enterprises",
  Reports: "reports",
  Requests: "requests",
  Monitoring: "monitoring",
  "Settings & Maintenance": "settings",
};

/** The Activity type choices. A `description` shows under its label in the open menu only. */
export const activityTypeOptions: readonly { value: ActivityTypeFilter; label: string; description?: string }[] = [
  { value: "all", label: "All Activity" },
  { value: "security", label: "Login & Security" },
  { value: "accounts", label: "Accounts" },
  { value: "enterprises", label: "Enterprises", description: "Registrations, details, opening hours, closures" },
  { value: "reports", label: "Reports" },
  { value: "requests", label: "Requests" },
  { value: "monitoring", label: "Monitoring", description: "Cameras, busy places, offline desktop apps" },
  { value: "busy", label: "Busiest Enterprises", description: "Places busier than usual right now" },
  { value: "settings", label: "Settings & Maintenance" },
];

/** The chip on each row and in the drawer header. */
export const activityKindChipLabels: Record<ActivityKind, string> = {
  security: "Login & security",
  accounts: "Accounts",
  enterprises: "Enterprises",
  reports: "Reports",
  requests: "Requests",
  monitoring: "Monitoring",
  settings: "Settings",
};

export function activityTypeLabel(type: ActivityTypeFilter) {
  return activityTypeOptions.find((option) => option.value === type)?.label ?? "All Activity";
}

export function parseActivityType(value: string | null): ActivityTypeFilter {
  return activityTypeOptions.some((option) => option.value === value) ? (value as ActivityTypeFilter) : "all";
}

export function activityKind(log: SystemLog): ActivityKind {
  return KIND_BY_GROUP[log.group] ?? "settings";
}

/** TANAW records a Monitoring activity when a place turns busier than usual, and again when it is back to usual. */
const BUSY_PLACE_ACTIONS: ReadonlySet<string> = new Set(["Busier Than Usual", "Back to Usual"]);

/** A Monitoring record about a busy place: listed under Busiest Enterprises as well as Monitoring. */
export function isBusyPlaceRecord(log: SystemLog) {
  return activityKind(log) === "monitoring" && (BUSY_PLACE_ACTIONS.has(log.action) || log.metadata?.alertType === "Busier Than Usual");
}

function matchesType(log: SystemLog, type: ActivityTypeFilter) {
  if (type === "all") return true;
  if (type === "busy") return isBusyPlaceRecord(log);
  return activityKind(log) === type;
}

const ACTION_TITLES: Record<string, string> = {
  // Login & Security
  Login: "Signed In",
  Logout: "Signed Out",
  "Account Locked": "Account Locked",
  "Password Changed": "Password Changed",
  "Password Reset": "Password Reset",
  "Password Recovery Request": "Password Recovery Requested",
  "Password Recovery Rejected": "Recovery Code or Link Rejected",
  // Accounts
  "Create Enterprise Account": "Enterprise Account Created",
  "Create LGU Account": "LGU Account Created",
  "Update Enterprise Account": "Enterprise Account Updated",
  "Update LGU Account": "LGU Account Updated",
  "Update Account Status": "Account Status Changed",
  "Resend Account Activation": "Invitation Resent",
  "Send Password Reset": "Password Reset Email Sent",
  "Account Activated": "Invitation Accepted",
  "Verify Proposed Account Email": "New Email Verified",
  "Update Profile": "Profile Updated",
  "Update Profile Logo": "Profile Photo Updated",
  "Update Lead Admin": "Lead Admin Updated",
  "Update Building Capacity": "Building Capacity Updated",
  "Approve Account Change": "Account Change Approved",
  "Decline Account Change": "Account Change Declined",
  // Reports
  "Submit Enterprise Report": "Report Submitted",
  "Report Pending Review": "Report Set to Pending Review",
  "Report Ready to Consolidate": "Report Review Completed",
  "Report Consolidated": "Report Consolidated",
  "Return Enterprise Report": "Report Returned for Correction",
  "Generate Final Report": "Consolidated Report Generated",
  "Notify Enterprise": "Message Sent to Enterprise",
  // Requests
  "Send Request": "Request Sent",
  "Request Account Change": "Account Change Requested",
  "Cancel Account Change": "Account Change Cancelled",
  "Reply to Request": "Reply Sent",
  "Add Note for IT": "Note Added for IT",
  "Start Request": "Request Started",
  "Request In Progress": "Request In Progress",
  "Request Resolved": "Request Resolved",
  "Reopen Request": "Request Reopened",
  "Move Request": "Request Moved to Another Group",
  // Monitoring
  "Busier Than Usual": "Busier Than Usual",
  "Back to Usual": "Back to Usual",
  "Camera Stopped Counting": "Camera Stopped Counting",
  "Camera Counting Again": "Camera Counting Again",
  "Desktop App Offline": "Desktop App Offline",
  "Mark Temporarily Closed": "Marked Temporarily Closed",
  "Clear Temporary Closure": "Temporary Closure Removed",
  "Change Opening Hours": "Opening Hours Changed",
  // Settings & Maintenance
  "Update System Settings": "System Settings Updated",
  "Delete Old Activity": "Old Activity Deleted",
  "Run Retention Cleanup": "Data Retention Cleanup Run",
  "Retry Email Delivery": "Email Delivery Retried",
  "Add Camera": "Camera Added",
  "Remove Camera": "Camera Removed",
  "Change Camera": "Camera Settings Changed",
  "Change Counting Area": "Counting Area Changed",
  "Reset Desktop Data": "Desktop Data Reset",
};

function metaString(log: SystemLog, key: string) {
  const value = log.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(log: SystemLog, key: string) {
  const value = log.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A readable, past-tense title for a logged action, such as "Report Submitted". */
export function activityTitle(log: SystemLog) {
  if (ACTION_TITLES[log.action]) return ACTION_TITLES[log.action];
  if (log.action.startsWith("Final Report ")) return `Consolidated Report ${log.action.slice("Final Report ".length)}`;
  return log.action;
}

const ROLE_LABELS: Record<SystemLogActorRole, string> = {
  Admin: "Administrator",
  "IT Personnel": "IT Personnel",
  "LGU Staff": "LGU Staff",
  "Enterprise Account": "Enterprise",
  System: "TANAW",
};

export function actorRoleLabel(role: SystemLogActorRole) {
  return ROLE_LABELS[role] ?? role;
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PHILIPPINE_TIME_ZONE });
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: PHILIPPINE_TIME_ZONE });

function validDate(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The Philippine calendar day of a timestamp, as `YYYY-MM-DD`. */
export function philippineDay(timestamp: string) {
  const date = validDate(timestamp);
  return date ? dayFormatter.format(date) : "";
}

/** "Nov 23, 2026" */
export function formatActivityDate(timestamp: string) {
  const date = validDate(timestamp);
  return date ? dateFormatter.format(date) : "Date unavailable";
}

/** "3:15 PM", or "15:15" with the 24-hour preference. */
export function formatActivityTime(timestamp: string, timeFormat: SystemTimeFormat) {
  const date = validDate(timestamp);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

function timestampValue(timestamp: string) {
  return validDate(timestamp)?.getTime() ?? 0;
}

/** Newest first. */
export function compareActivity(left: SystemLog, right: SystemLog) {
  return timestampValue(right.timestamp) - timestampValue(left.timestamp) || left.id.localeCompare(right.id);
}

export type ActivityFilters = {
  type: ActivityTypeFilter;
  query: string;
  range: Pick<DateRange, "start" | "end">;
};

export function activitySearchText(log: SystemLog) {
  return [activityTitle(log), log.action, log.actor, actorRoleLabel(log.actorRole), log.target, log.summary, log.itDetail ?? ""].join(" ").toLowerCase();
}

/** The activity list: in range, of the type, matching the search, newest first. */
export function filterRecentActivity(logs: readonly SystemLog[], filters: ActivityFilters) {
  const query = filters.query.trim().toLowerCase();
  return logs
    .filter((log) => {
      const day = philippineDay(log.timestamp);
      if (!day || day < filters.range.start || day > filters.range.end) return false;
      if (!matchesType(log, filters.type)) return false;
      return !query || activitySearchText(log).includes(query);
    })
    .sort(compareActivity);
}

export function activityPageCount(total: number, pageSize = ACTIVITY_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The 1-based page that holds the item at `index`. */
export function activityPageOf(index: number, pageSize = ACTIVITY_PAGE_SIZE) {
  return index < 0 ? 1 : Math.floor(index / pageSize) + 1;
}

/** One page of rows, with the page clamped to the available pages and the "Showing 1–8 of 42" text. */
export function paginateActivity<T>(items: readonly T[], page: number, pageSize = ACTIVITY_PAGE_SIZE) {
  const pageCount = activityPageCount(items.length, pageSize);
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const rows = items.slice(start, start + pageSize);
  const summary = items.length ? `Showing ${start + 1}–${start + rows.length} of ${items.length}` : "Showing 0 of 0";
  return { page: current, pageCount, rows, summary };
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** "All activity · 42 records" */
export function activitySummaryParts(items: readonly SystemLog[], type: ActivityTypeFilter, query: string) {
  const count = query.trim() ? `${items.length} matching ${items.length === 1 ? "record" : "records"}` : plural(items.length, "record");
  return { label: type === "all" ? "All activity" : activityTypeLabel(type), count };
}

/**
 * The sentence under the column headers when no record matches. Under Busiest Enterprises, without
 * a search, it also says so when no place is busy now (`noneBusyNow`: the range includes today and
 * no busy place is pinned).
 */
export function activityEmptyMessage({ type, query, rangeText, noneBusyNow = false }: { type: ActivityTypeFilter; query: string; rangeText: string; noneBusyNow?: boolean }) {
  const search = query.trim();
  const matching = search ? `matching “${search}” ` : "";
  if (type === "busy") {
    const records = `No busy-place records ${matching}for ${rangeText}.`;
    return noneBusyNow && !search ? `No place is busier than usual right now. ${records}` : records;
  }
  if (type === "all" && !search) return `No activity recorded for ${rangeText}.`;
  return `No ${type === "all" ? "activity" : activityTypeLabel(type).toLowerCase()} ${matching}for ${rangeText}.`;
}

/** Sample data prefixes source IDs, for example `sample:activity:alert:<id>`. */
export function activitySourceId(log: SystemLog) {
  return log.sourceId ? log.sourceId.replace(/^sample:activity:[a-z-]+:/, "") : null;
}

/** The request a Requests activity belongs to, for the Requests deep link. */
export function activityRequestId(log: SystemLog) {
  return activityKind(log) === "requests" ? activitySourceId(log) : null;
}

/** The request code for Requests activity, otherwise "ACT-" and the start of the log ID. */
export function activityReference(log: SystemLog) {
  const code = metaString(log, "requestCode");
  if (code) return code;
  return `ACT-${log.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()}`;
}

/** The Enterprise Reports month params for a period such as "October 2026": `month=October&year=2026`. */
export function reportMonthParams(period: string | null) {
  const match = period?.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_NAMES.find((name) => name.toLowerCase() === match[1].toLowerCase());
  return month ? { month, year: match[2] } : null;
}

/** The IT screens IT's activity links to. Literal paths, so they do not depend on route names. */
const IT_PATHS = { overview: "/it/dashboard", requests: "/it/requests", enterprises: "/it/enterprises" } as const;

export type ActivityField = { label: string; value: string; tone?: RecordStatusTone };
export type ActivityLink = { label: string; to: string };

function reportFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [];
  const isConsolidated = log.action.includes("Final Report");
  fields.push({ label: isConsolidated ? "Consolidated report" : "Enterprise", value: log.target });
  const period = metaString(log, "period");
  if (period) fields.push({ label: "Period", value: period });
  if (log.action === "Submit Enterprise Report") fields.push({ label: "Submission", value: "Submitted", tone: "submitted" });
  if (log.action.startsWith("Report ")) {
    const stored = log.action.slice("Report ".length);
    if (["Pending Review", "Ready to Consolidate", "Consolidated"].includes(stored)) {
      const review = reviewStatus({ status: stored as "Pending Review" | "Ready to Consolidate" | "Consolidated" });
      fields.push({ label: "Staff review", value: review, tone: reviewTone[review] });
    }
  }
  if (log.action === "Return Enterprise Report") {
    const review = reviewStatus({ status: "Returned" });
    fields.push({ label: "Staff review", value: review, tone: reviewTone[review] });
    const version = metaNumber(log, "version");
    if (version !== null && version > 1) fields.push({ label: "Version", value: String(version) });
    const reason = metaString(log, "reason");
    if (reason) fields.push({ label: "Reason", value: reason });
  }
  if (log.action.startsWith("Final Report ")) fields.push({ label: "Status", value: log.action.slice("Final Report ".length) });
  const unique = metaNumber(log, "uniqueCount");
  if (unique !== null) fields.push({ label: "Unique visitors", value: unique.toLocaleString("en-US") });
  const reportCount = metaNumber(log, "reportCount");
  if (reportCount !== null) fields.push({ label: "Reports included", value: plural(reportCount, "report") });
  const remarks = metaString(log, "remarks");
  if (remarks) fields.push({ label: "Remarks", value: remarks });
  return fields;
}

function change(previous: string | number | null, next: string | number | null) {
  if (previous === null && next === null) return null;
  return `${previous ?? "Not set"} → ${next ?? "Not set"}`;
}

function accountFields(log: SystemLog, label = "Account"): ActivityField[] {
  const fields: ActivityField[] = [{ label, value: log.target || log.actor }];
  const value = change(metaString(log, "previousValue"), metaString(log, "requestedValue"));
  if (value) fields.push({ label: "Change", value });
  const email = change(metaString(log, "previousEmail"), metaString(log, "requestedEmail"));
  if (email) fields.push({ label: "Email", value: email });
  const capacity = change(metaNumber(log, "previousBuildingCapacity"), metaNumber(log, "buildingCapacity"));
  if (capacity) fields.push({ label: "Building capacity", value: capacity });
  const resolution = metaString(log, "resolution");
  if (resolution) fields.push({ label: "Decision", value: resolution === "approve" ? "Approved" : resolution === "decline" ? "Declined" : resolution });
  const barangay = metaString(log, "barangay");
  if (barangay) fields.push({ label: "Barangay", value: barangay });
  return fields;
}

function requestFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [{ label: "Request", value: activityReference(log) }];
  const group = metaString(log, "requestGroup");
  if (group) fields.push({ label: "Group", value: group });
  return fields;
}

function otherFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [];
  if (log.target && log.target !== log.actor) fields.push({ label: activityKind(log) === "monitoring" ? "Place" : "Affected item", value: log.target });
  const deleted = metaNumber(log, "deletedCount");
  if (deleted !== null) fields.push({ label: "Records deleted", value: deleted.toLocaleString("en-US") });
  const retention = metaNumber(log, "retentionDays");
  if (retention !== null) fields.push({ label: "Kept for", value: plural(retention, "day") });
  const minutes = metaNumber(log, "minutes");
  if (minutes !== null) fields.push({ label: "Offline for", value: plural(minutes, "minute") });
  return fields;
}

/** The DETAILS list in the drawer, built only from what the record carries. */
export function activityDetailFields(log: SystemLog): ActivityField[] {
  const kind = activityKind(log);
  if (kind === "reports") return reportFields(log);
  if (kind === "accounts") return accountFields(log);
  if (kind === "enterprises") return accountFields(log, "Enterprise");
  if (kind === "requests") return requestFields(log);
  return otherFields(log);
}

/** Links from the drawer to the screens that hold the full record. `portal` picks the Admin or IT pages. */
export function activityLinks(log: SystemLog, portal: "admin" | "it" = "admin"): ActivityLink[] {
  const links: ActivityLink[] = [];
  const kind = activityKind(log);
  const requestId = activityRequestId(log);
  if (requestId) {
    links.push(
      portal === "admin"
        ? { label: "Open the request", to: `${routes.admin.requests}?request=${encodeURIComponent(requestId)}` }
        : { label: "Open the request", to: `${IT_PATHS.requests}?request=${encodeURIComponent(requestId)}` },
    );
  }
  if (kind === "monitoring") links.push(portal === "admin" ? { label: "Open the Dashboard", to: routes.admin.dashboard } : { label: "Open the Overview", to: IT_PATHS.overview });
  if (portal === "admin" && kind === "reports") {
    const params = new URLSearchParams();
    const month = reportMonthParams(metaString(log, "period"));
    const enterpriseId = metaString(log, "enterpriseId");
    if (enterpriseId) params.set("enterprise", enterpriseId);
    if (month) {
      params.set("month", month.month);
      params.set("year", month.year);
    }
    const query = params.toString();
    links.push({ label: "Open Enterprise Reports", to: query ? `${routes.admin.reports}?${query}` : routes.admin.reports });
  }
  const enterpriseId = metaString(log, "enterpriseId");
  if (enterpriseId) links.push({ label: "Open enterprise details", to: portal === "admin" ? adminEnterpriseDetailsPath(enterpriseId) : `${IT_PATHS.enterprises}/${encodeURIComponent(enterpriseId)}` });
  return links;
}
