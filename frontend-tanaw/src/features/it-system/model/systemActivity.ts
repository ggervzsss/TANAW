import type { ApiSchemas } from "@/contracts/api";
import { activityLinks, activitySourceId, activityTitle, compareActivity, philippineDay, type ActivityLink } from "@/features/system-logs/model/recentActivity";
import type { ActivityGroup, SystemLog, SystemLogActorRole } from "@/shared/types";
import { formatPhilippineDate, type SystemDateFormat } from "@/shared/utils/dateTime";

/*
 * The Activity tab on IT's System page: every record, newest first, in five types. IT reads the
 * technical side of each record too: `itDetail`, and the IP address, browser and session the
 * backend sends only to IT.
 */

export type ActivityTechnical = ApiSchemas["ActivityLogTechnical"];

/** An activity record as IT receives it, with the request's technical detail. */
export type SystemActivityLog = SystemLog & { technical?: ActivityTechnical | null };

export type SystemActivityType = "security" | "requests" | "accounts" | "enterprises" | "system";
export type SystemActivityFilter = "all" | SystemActivityType;

/** Rows shown at first, and added by each "Show more". */
export const SYSTEM_ACTIVITY_PAGE_SIZE = 25;

const TYPE_BY_GROUP: Record<ActivityGroup, SystemActivityType> = {
  "Login & Security": "security",
  Requests: "requests",
  Accounts: "accounts",
  Enterprises: "enterprises",
  Monitoring: "system",
  "Settings & Maintenance": "system",
  Reports: "system",
};

export const SYSTEM_ACTIVITY_TYPE_LABELS: Record<SystemActivityType, string> = {
  security: "Sign-in and security",
  requests: "Requests",
  accounts: "Accounts",
  enterprises: "Enterprises",
  system: "System",
};

export const systemActivityFilterOptions: readonly { value: SystemActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(SYSTEM_ACTIVITY_TYPE_LABELS) as SystemActivityType[]).map((value) => ({ value, label: SYSTEM_ACTIVITY_TYPE_LABELS[value] })),
];

export function systemActivityType(log: Pick<SystemLog, "group">): SystemActivityType {
  return TYPE_BY_GROUP[log.group] ?? "system";
}

export function parseSystemActivityFilter(value: string | null): SystemActivityFilter {
  return systemActivityFilterOptions.some((option) => option.value === value) ? (value as SystemActivityFilter) : "all";
}

/** The records of one type, newest first. */
export function filterSystemActivity<T extends SystemLog>(logs: readonly T[], filter: SystemActivityFilter): T[] {
  return logs.filter((log) => filter === "all" || systemActivityType(log) === filter).sort(compareActivity);
}

/**
 * How many rows to show: whole pages up to `pages`, and always enough to include the row at
 * `selectedIndex`, so a linked activity is on screen.
 */
export function visibleActivityCount(total: number, pages: number, selectedIndex = -1, pageSize = SYSTEM_ACTIVITY_PAGE_SIZE) {
  const wanted = Math.max(1, pages) * pageSize;
  const withSelected = selectedIndex >= 0 ? Math.ceil((selectedIndex + 1) / pageSize) * pageSize : 0;
  return Math.min(total, Math.max(wanted, withSelected));
}

const ROLE_LABELS: Record<SystemLogActorRole, string> = {
  Admin: "Admin",
  "IT Personnel": "IT",
  "LGU Staff": "Staff",
  "Enterprise Account": "Enterprise",
  System: "System",
};

/** The short role under the person's name: Admin, IT, Staff, Enterprise or System. */
export function itActorRoleLabel(role: string | null | undefined) {
  if (!role) return "";
  return ROLE_LABELS[role as SystemLogActorRole] ?? role;
}

function addDays(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or the date in the system date format, for Philippine calendar days. */
export function activityDayLabel(timestamp: string, now: Date, dateFormat: SystemDateFormat) {
  const day = philippineDay(timestamp);
  if (!day) return "Date unavailable";
  const today = philippineDay(now.toISOString());
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatPhilippineDate(timestamp, dateFormat);
}

function majorVersion(version: string | undefined) {
  return version?.split(".")[0] ?? "";
}

function operatingSystem(userAgent: string) {
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/CrOS/i.test(userAgent)) return "ChromeOS";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return null;
}

function browser(userAgent: string) {
  const match = (pattern: RegExp) => userAgent.match(pattern)?.[1];
  const desktop = match(/desktop-tanaw\/([\d.]+)/i);
  if (desktop) return `TANAW desktop app ${desktop}`;
  if (/Electron\//i.test(userAgent)) return "TANAW desktop app";
  const edge = match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  if (edge) return `Edge ${majorVersion(edge)}`;
  const opera = match(/OPR\/([\d.]+)/);
  if (opera) return `Opera ${majorVersion(opera)}`;
  const firefox = match(/(?:Firefox|FxiOS)\/([\d.]+)/);
  if (firefox) return `Firefox ${majorVersion(firefox)}`;
  const chrome = match(/(?:Chrome|CriOS)\/([\d.]+)/);
  if (chrome) return `Chrome ${majorVersion(chrome)}`;
  const safari = /Safari\//.test(userAgent) ? match(/Version\/([\d.]+)/) : undefined;
  if (safari) return `Safari ${majorVersion(safari)}`;
  return null;
}

/**
 * A short, readable name for a user agent: "Chrome 131 on Windows", "TANAW desktop app 0.1.3 on
 * Windows". Tools that are not browsers keep their own name ("python-httpx 0.27").
 */
export function summarizeUserAgent(userAgent: string | null | undefined) {
  const value = userAgent?.trim();
  if (!value) return null;
  const name = browser(value);
  const os = operatingSystem(value);
  if (name) return os ? `${name} on ${os}` : name;
  const tool = value.match(/^([A-Za-z][\w.-]*)\/([\w.]+)/);
  if (tool) return `${tool[1]} ${tool[2]}`;
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

export type TechnicalField = {
  label: string;
  value: string;
  /** A second, fuller line, such as the full user agent. */
  detail?: string;
  /** Shown in the monospace face: addresses and IDs. */
  mono?: boolean;
};

function metaString(log: SystemLog, key: string) {
  const value = log.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Where the record came from: IP address, browser and session, or why they are missing. */
export function activityOriginFields(log: SystemActivityLog): TechnicalField[] {
  const technical = log.technical;
  if (!technical) {
    return [{ label: "Where from", value: log.actorRole === "System" ? "TANAW itself, not a browser" : "Not recorded" }];
  }
  const userAgent = technical.userAgent?.trim() || null;
  const summary = summarizeUserAgent(userAgent);
  return [
    { label: "IP address", value: technical.ipAddress?.trim() || "Not recorded", mono: Boolean(technical.ipAddress?.trim()) },
    { label: "Browser", value: summary ?? "Not recorded", detail: userAgent && userAgent !== summary ? userAgent : undefined },
    { label: "Session", value: technical.sessionId?.trim() || "Not recorded", mono: Boolean(technical.sessionId?.trim()) },
  ];
}

/** The IDs IT may need to trace a record: the record itself, its source, and linked items. */
export function activityIdFields(log: SystemActivityLog): TechnicalField[] {
  const fields: TechnicalField[] = [];
  const requestCode = metaString(log, "requestCode");
  if (requestCode) fields.push({ label: "Request", value: requestCode, mono: true });
  const enterpriseId = metaString(log, "enterpriseId");
  if (enterpriseId) fields.push({ label: "Enterprise ID", value: enterpriseId, mono: true });
  const sourceId = activitySourceId(log);
  if (sourceId) fields.push({ label: "Source ID", value: sourceId, mono: true });
  fields.push({ label: "Activity ID", value: log.id, mono: true });
  return fields;
}

export type SystemActivityRow = {
  log: SystemActivityLog;
  day: string;
  title: string;
  actor: string;
  role: string;
  type: SystemActivityType;
  typeLabel: string;
};

/** Everything a row shows except the time, which the row formats in the system time format. */
export function systemActivityRow(log: SystemActivityLog, now: Date, dateFormat: SystemDateFormat): SystemActivityRow {
  const type = systemActivityType(log);
  return {
    log,
    day: activityDayLabel(log.timestamp, now, dateFormat),
    title: activityTitle(log),
    actor: log.actor,
    role: itActorRoleLabel(log.actorRole),
    type,
    typeLabel: SYSTEM_ACTIVITY_TYPE_LABELS[type],
  };
}

/** Links from an expanded row to the IT screens that hold the full record. */
export function systemActivityLinks(log: SystemActivityLog): ActivityLink[] {
  return activityLinks(log, "it");
}
