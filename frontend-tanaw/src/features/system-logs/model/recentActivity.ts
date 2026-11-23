import { adminEnterpriseDetailsPath, routes } from "@/app/routers/routes";
import { MONTH_NAMES, reviewStatus, reviewTone } from "@/features/reports/model/reportStatuses";
import type { SystemLog, SystemLogActorRole } from "@/shared/types";
import type { DateRange, RecordStatusTone } from "@/shared/ui-kit";
import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * Recent Activity (Admin): the activity log as six types, with unresolved help requests pinned.
 *
 * Types, decided from the logged action first and the log category second:
 *   help      support tickets (sent, replied to, status changed) and operational alerts (raised,
 *             resolved, desktop app problems), the same records the Requests page lists, plus any
 *             log the backend tracks as an issue (it carries a resolutionStatus).
 *   security  sign-in, sign-out and password recovery attempts, and System warnings.
 *   accounts  accounts created or changed, profile changes, password changes and activation.
 *   reports   enterprise report submissions, staff review decisions and consolidated reports.
 *   actions   everything else any TANAW user did, such as messages to enterprises or settings.
 *
 * Pinned: a log whose resolutionStatus is "Unresolved" (the backend keeps it Unresolved until IT
 * resolves the ticket or alert in Work Center). Pinned logs come first and ignore the date range.
 */

export type ActivityKind = "reports" | "actions" | "accounts" | "help" | "security";
export type ActivityTypeFilter = "all" | ActivityKind;

export const ACTIVITY_PAGE_SIZE = 8;

/** The query parameter that holds the activity open in the drawer: `/admin/activity?activity=<log id>`. */
export const ACTIVITY_PARAM = "activity";

export const activityTypeOptions: readonly { value: ActivityTypeFilter; label: string; meta?: string }[] = [
  { value: "all", label: "All Activities" },
  { value: "reports", label: "Report Updates" },
  { value: "actions", label: "User Actions", meta: "By any TANAW user" },
  { value: "accounts", label: "Account Changes" },
  { value: "help", label: "Help Requests" },
  { value: "security", label: "Login & Security" },
];

/** The chip on each row and in the drawer header. */
export const activityKindChipLabels: Record<ActivityKind, string> = {
  reports: "Report update",
  actions: "User action",
  accounts: "Account change",
  help: "Help request",
  security: "Login & security",
};

export function activityTypeLabel(type: ActivityTypeFilter) {
  return activityTypeOptions.find((option) => option.value === type)?.label ?? "All Activities";
}

export function parseActivityType(value: string | null): ActivityTypeFilter {
  return activityTypeOptions.some((option) => option.value === value) ? (value as ActivityTypeFilter) : "all";
}

const TICKET_ACTIONS = new Set(["Submit Support Ticket", "Submit Important Support Request", "Reply Support Ticket", "Update Support Ticket Status"]);
const ALERT_ACTIONS = new Set(["Alert Created", "Alert Resolved", "Desktop Application Problem", "Technical Issue Resolved"]);
const SECURITY_ACTIONS = new Set([
  "Login",
  "Logout",
  "Password Recovery Request",
  "Password Recovery Code Verified",
  "Password Recovery Verification Rejected",
  "Password Recovery Reset Rejected",
  "Password Recovery Reset Completed",
]);
const ACCOUNT_ACTIONS = new Set([
  "Create Enterprise Account",
  "Create LGU Account",
  "Update Enterprise Account",
  "Update LGU Account",
  "Update Account Status",
  "Approve Verified Email Change",
  "Decline Verified Email Change",
  "Approve Enterprise Profile Change",
  "Decline Enterprise Profile Change",
  "Resend Account Activation",
  "Activation Email Queued",
  "Account Activated",
  "Verify Proposed Account Email",
  "Update Profile",
  "Update Profile Logo",
  "Update Lead Admin",
  "Update Building Capacity",
  "Request Account Update",
  "Request Contact Number Change",
  "Request Business Email Change",
  "Cancel Business Email Change",
  "Password Changed",
  "Password Reset",
]);
const REPORT_ACTIONS = new Set(["Submit Enterprise Report", "Generate Final Report", "Return Final Report for Revision"]);

export function activityKind(log: SystemLog): ActivityKind {
  const { action } = log;
  if (log.resolutionStatus || TICKET_ACTIONS.has(action) || ALERT_ACTIONS.has(action) || action.startsWith("Alert ")) return "help";
  if (SECURITY_ACTIONS.has(action)) return "security";
  if (ACCOUNT_ACTIONS.has(action)) return "accounts";
  if (REPORT_ACTIONS.has(action) || action.startsWith("Report ") || action.startsWith("Final Report ") || log.category === "Staff Submission") return "reports";
  if (log.category === "System" && (log.severity === "Warning" || log.severity === "Critical")) return "security";
  return "actions";
}

/** Unresolved help or issue records stay pinned at the top until IT resolves them. */
export function isPinnedActivity(log: SystemLog) {
  return log.resolutionStatus === "Unresolved";
}

const ACTION_TITLES: Record<string, string> = {
  Login: "Signed In",
  Logout: "Signed Out",
  "Password Recovery Request": "Password Recovery Requested",
  "Password Recovery Code Verified": "Recovery Code Verified",
  "Password Recovery Verification Rejected": "Recovery Code Rejected",
  "Password Recovery Reset Rejected": "Password Reset Rejected",
  "Password Recovery Reset Completed": "Password Reset Completed",
  "Password Changed": "Password Changed",
  "Password Reset": "Password Reset",
  "Submit Enterprise Report": "Report Submitted",
  "Report Pending Review": "Report Set to Pending Review",
  "Report Returned": "Report Sent Back for Correction",
  "Report Ready to Consolidate": "Report Review Completed",
  "Report Consolidated": "Report Consolidated",
  "Generate Final Report": "Consolidated Report Generated",
  "Return Final Report for Revision": "Consolidated Report Returned for Revision",
  "Notify Enterprise": "Message Sent to Enterprise",
  "Submit Support Ticket": "Support Request Sent",
  "Submit Important Support Request": "Important Support Request Sent",
  "Reply Support Ticket": "Support Request Reply Sent",
  "Update Support Ticket Status": "Support Request Updated",
  "Desktop Application Problem": "Desktop App Problem Reported",
  "Technical Issue Resolved": "Technical Issue Resolved",
  "Create Enterprise Account": "Enterprise Account Created",
  "Create LGU Account": "LGU Account Created",
  "Update Enterprise Account": "Enterprise Account Updated",
  "Update LGU Account": "LGU Account Updated",
  "Update Account Status": "Account Status Changed",
  "Approve Verified Email Change": "Email Change Approved",
  "Decline Verified Email Change": "Email Change Declined",
  "Approve Enterprise Profile Change": "Profile Change Approved",
  "Decline Enterprise Profile Change": "Profile Change Declined",
  "Resend Account Activation": "Activation Invitation Resent",
  "Activation Email Queued": "Activation Email Queued",
  "Account Activated": "Account Activated",
  "Verify Proposed Account Email": "New Email Verified",
  "Update Profile": "Profile Updated",
  "Update Profile Logo": "Profile Photo Updated",
  "Update Lead Admin": "Lead Admin Updated",
  "Update Building Capacity": "Building Capacity Updated",
  "Request Account Update": "Account Update Requested",
  "Request Contact Number Change": "Contact Number Change Requested",
  "Request Business Email Change": "Business Email Change Requested",
  "Cancel Business Email Change": "Business Email Change Cancelled",
  "Update System Settings": "System Settings Updated",
  "Delete Old Activity": "Old Activity Deleted",
  "Run Retention Cleanup": "Data Retention Cleanup Run",
  "Retry Email Delivery": "Email Delivery Retried",
};

const ALERT_NAMES: Record<string, string> = {
  "Maintenance Request": "Maintenance Request",
  "Password Reset Request": "Password Reset Request",
  "Submission Delay": "Late Report Alert",
  "Foot Traffic Alert": "Busy Establishment Alert",
  "Occupancy Spike": "Crowd Spike Alert",
  "Failed Login Threshold": "Repeated Failed Sign-in Alert",
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
  if (log.action === "Alert Created" || log.action === "Alert Resolved") {
    const alertType = metaString(log, "alertType");
    const name = (alertType && ALERT_NAMES[alertType]) ?? "Alert";
    return log.action === "Alert Resolved" ? `${name} Resolved` : `${name} Raised`;
  }
  if (ACTION_TITLES[log.action]) return ACTION_TITLES[log.action];
  if (log.action.startsWith("Final Report ")) return `Consolidated Report ${log.action.slice("Final Report ".length)}`;
  return log.action;
}

const ROLE_LABELS: Record<SystemLogActorRole, string> = {
  Admin: "Administrator",
  "IT Personnel": "IT Personnel",
  "LGU Staff": "LGU Staff",
  "Enterprise Account": "Enterprise",
  System: "System",
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

/** How long an unresolved record has been open: "less than a day", "1 day", "3 days". */
export function openDurationLabel(timestamp: string, now: Date) {
  const date = validDate(timestamp);
  if (!date) return "for an unknown time";
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return "less than a day";
  return days === 1 ? "1 day" : `${days} days`;
}

function timestampValue(timestamp: string) {
  return validDate(timestamp)?.getTime() ?? 0;
}

/** Pinned first, then newest first. */
export function compareActivity(left: SystemLog, right: SystemLog) {
  return Number(isPinnedActivity(right)) - Number(isPinnedActivity(left)) || timestampValue(right.timestamp) - timestampValue(left.timestamp) || left.id.localeCompare(right.id);
}

export type ActivityFilters = {
  type: ActivityTypeFilter;
  query: string;
  range: Pick<DateRange, "start" | "end">;
};

export function activitySearchText(log: SystemLog) {
  return [activityTitle(log), log.action, log.actor, actorRoleLabel(log.actorRole), log.target, log.summary].join(" ").toLowerCase();
}

/** The activity list: in range (pinned records ignore the range), of the type, matching the search; pinned first, newest first. */
export function filterRecentActivity(logs: readonly SystemLog[], filters: ActivityFilters) {
  const query = filters.query.trim().toLowerCase();
  return logs
    .filter((log) => {
      if (!isPinnedActivity(log)) {
        const day = philippineDay(log.timestamp);
        if (!day || day < filters.range.start || day > filters.range.end) return false;
      }
      if (filters.type !== "all" && activityKind(log) !== filters.type) return false;
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

/** "All activity · 42 records · 2 unresolved pinned · Nov 1 – 23, 2026" */
export function activitySummaryParts(items: readonly SystemLog[], type: ActivityTypeFilter, query: string) {
  const pinned = items.filter(isPinnedActivity).length;
  const count = query.trim() ? `${items.length} matching ${items.length === 1 ? "record" : "records"}` : plural(items.length, "record");
  return { label: type === "all" ? "All activity" : activityTypeLabel(type), count, pinned: `${pinned} unresolved pinned` };
}

/** Sample data prefixes source IDs, for example `sample:activity:ticket:<id>`. */
export function activitySourceId(log: SystemLog) {
  return log.sourceId ? log.sourceId.replace(/^sample:activity:[a-z-]+:/, "") : null;
}

/** The request a help activity belongs to, for the Requests deep link. */
export function activityRequest(log: SystemLog): { kind: "ticket" | "alert"; id: string } | null {
  const id = activitySourceId(log);
  if (!id) return null;
  if (TICKET_ACTIONS.has(log.action) || /(^|:)ticket:/.test(log.sourceId ?? "")) return { kind: "ticket", id };
  if (ALERT_ACTIONS.has(log.action) || log.action.startsWith("Alert ") || /(^|:)(alert|technical):/.test(log.sourceId ?? "")) return { kind: "alert", id };
  return null;
}

/** The ticket code for support requests, otherwise "ACT-" and the start of the log ID. */
export function activityReference(log: SystemLog) {
  if (activityRequest(log)?.kind === "ticket" && log.target.trim()) return log.target.trim();
  return `ACT-${log.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()}`;
}

export type ActivityProgress = { label: string; tone: RecordStatusTone };

const STATUS_PROGRESS: Record<string, ActivityProgress> = {
  New: { label: "Open", tone: "pending" },
  Open: { label: "Open", tone: "pending" },
  "In Review": { label: "In progress", tone: "reviewing" },
  Resolved: { label: "Resolved", tone: "consolidated" },
};

/** Where a help request stands now (from resolutionStatus), or null when the log does not say. */
export function activityProgress(log: SystemLog): ActivityProgress | null {
  if (log.resolutionStatus === "Resolved") return { label: "Resolved", tone: "consolidated" };
  if (log.resolutionStatus === "Unresolved") return { label: "Not resolved yet", tone: "pending" };
  return null;
}

/** The Enterprise Reports month params for a period such as "October 2026": `month=October&year=2026`. */
export function reportMonthParams(period: string | null) {
  const match = period?.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_NAMES.find((name) => name.toLowerCase() === match[1].toLowerCase());
  return month ? { month, year: match[2] } : null;
}

export type ActivityField = { label: string; value: string; tone?: RecordStatusTone };
export type ActivityLink = { label: string; to: string };

const ALERT_TYPE_LABELS: Record<string, string> = {
  "Maintenance Request": "Maintenance request",
  "Password Reset Request": "Password reset request",
  "Submission Delay": "Late enterprise report",
  "Foot Traffic Alert": "Busy establishment",
  "Occupancy Spike": "Sudden crowd increase",
  "Failed Login Threshold": "Repeated failed sign-ins",
};

function helpFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [];
  const request = activityRequest(log);
  if (request?.kind === "ticket") fields.push({ label: "Request ID", value: activityReference(log) });
  const ticketCategory = metaString(log, "category");
  const alertType = metaString(log, "alertType");
  if (ticketCategory) fields.push({ label: "Type", value: ticketCategory });
  else if (alertType) fields.push({ label: "Type", value: ALERT_TYPE_LABELS[alertType] ?? alertType });
  else if (log.action === "Desktop Application Problem") fields.push({ label: "Type", value: "Desktop app problem" });
  const place = log.actorRole === "Enterprise Account" ? log.actor : request?.kind === "alert" ? log.target : null;
  if (place) fields.push({ label: "Location", value: place });
  const camera = metaString(log, "cameraName");
  if (camera) fields.push({ label: "Camera", value: camera });
  const priority = metaString(log, "priority");
  if (priority) fields.push({ label: "Priority", value: priority });
  const attachments = metaNumber(log, "attachmentCount");
  if (attachments !== null) fields.push({ label: "Attachments", value: attachments === 0 ? "None" : plural(attachments, "file") });
  const progress = activityProgress(log);
  const statusThen = metaString(log, "status");
  if (progress) fields.push({ label: "Progress", value: progress.label, tone: progress.tone });
  if (statusThen && STATUS_PROGRESS[statusThen]) {
    const recorded = STATUS_PROGRESS[statusThen];
    fields.push({ label: log.action === "Update Support Ticket Status" ? "Changed to" : "Status when recorded", value: recorded.label, tone: recorded.tone });
  }
  return fields;
}

function reportFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [];
  const isConsolidated = log.action.includes("Final Report");
  fields.push({ label: isConsolidated ? "Consolidated report" : "Enterprise", value: log.target });
  const period = metaString(log, "period");
  if (period) fields.push({ label: "Period", value: period });
  if (log.action === "Submit Enterprise Report") fields.push({ label: "Submission", value: "Submitted", tone: "submitted" });
  if (log.action.startsWith("Report ")) {
    const stored = log.action.slice("Report ".length);
    if (["Pending Review", "Returned", "Ready to Consolidate", "Consolidated"].includes(stored)) {
      const review = reviewStatus({ status: stored as "Pending Review" | "Returned" | "Ready to Consolidate" | "Consolidated" });
      fields.push({ label: "Staff review", value: review, tone: reviewTone[review] });
    }
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

function accountFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [{ label: "Account", value: log.target || log.actor }];
  const requestType = metaString(log, "requestType");
  if (requestType) fields.push({ label: "Change requested", value: requestType });
  const value = change(metaString(log, "previousValue"), metaString(log, "requestedValue"));
  if (value) fields.push({ label: "Change", value });
  const email = change(metaString(log, "previousEmail"), metaString(log, "requestedEmail"));
  if (email) fields.push({ label: "Email", value: email });
  const capacity = change(metaNumber(log, "previousBuildingCapacity"), metaNumber(log, "buildingCapacity"));
  if (capacity) fields.push({ label: "Building capacity", value: capacity });
  const resolution = metaString(log, "resolution");
  if (resolution) fields.push({ label: "Decision", value: resolution === "approve" ? "Approved" : resolution === "decline" ? "Declined" : resolution });
  const status = metaString(log, "status");
  if (status) fields.push({ label: "Account status", value: status.charAt(0).toUpperCase() + status.slice(1) });
  const barangay = metaString(log, "barangay");
  if (barangay) fields.push({ label: "Barangay", value: barangay });
  return fields;
}

function otherFields(log: SystemLog): ActivityField[] {
  const fields: ActivityField[] = [{ label: "Account", value: `${log.actor}, ${actorRoleLabel(log.actorRole)}` }];
  if (log.target && log.target !== log.actor) fields.push({ label: "Affected item", value: log.target });
  const purpose = metaString(log, "purpose");
  if (purpose) fields.push({ label: "Email purpose", value: purpose });
  const deleted = metaNumber(log, "deletedCount");
  if (deleted !== null) fields.push({ label: "Records deleted", value: deleted.toLocaleString("en-US") });
  const retention = metaNumber(log, "retentionDays");
  if (retention !== null) fields.push({ label: "Kept for", value: plural(retention, "day") });
  return fields;
}

/** The DETAILS list in the drawer, built only from what the log carries. */
export function activityDetailFields(log: SystemLog): ActivityField[] {
  const kind = activityKind(log);
  if (kind === "help") return helpFields(log);
  if (kind === "reports") return reportFields(log);
  if (kind === "accounts") return accountFields(log);
  return otherFields(log);
}

/** Links from the drawer to the screens that hold the full record. */
export function activityLinks(log: SystemLog): ActivityLink[] {
  const links: ActivityLink[] = [];
  const kind = activityKind(log);
  const request = kind === "help" ? activityRequest(log) : null;
  if (request) links.push({ label: "View details", to: `${routes.admin.requests}?${request.kind}=${encodeURIComponent(request.id)}` });
  else if (kind === "help") links.push({ label: "Open Requests", to: routes.admin.requests });
  if (kind === "reports") {
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
  if (log.action === "Approve Enterprise Profile Change" || log.action === "Decline Enterprise Profile Change") links.push({ label: "Open Requests", to: routes.admin.requests });
  const enterpriseId = metaString(log, "enterpriseId");
  if (enterpriseId) links.push({ label: "Open enterprise details", to: adminEnterpriseDetailsPath(enterpriseId) });
  else if (log.action === "Create Enterprise Account" || log.action === "Update Enterprise Account") links.push({ label: "Open Registered Enterprises", to: routes.admin.enterprises });
  return links;
}
