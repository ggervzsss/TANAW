/*
 * The Admin Requests screen merges three sources into one list:
 * - operational alerts the Admin can see (`/operational/alerts`),
 * - High and Urgent support tickets (`/operational/tickets`),
 * - pending enterprise profile change requests (`profileChangeRequests` on enterprise accounts).
 * Each becomes an `AdminRequest` with a type, a progress and a version used for read tracking.
 */
import type { SupportTicket, SupportTicketAttachment } from "@/shared/services/supportTickets";
import type { AccountProfileChangeRequest, AccountSummary, PriorityAlert, PriorityAlertType, ProfileChangeRequestType } from "@/shared/types";
import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

export const REQUEST_TYPES = ["Camera issue", "Report concern", "Account and access", "Desktop app and maintenance", "Other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * Seen by IT (New / Open / a pending account change), In progress (In Review) and Resolved. Alerts that
 * Admins own themselves, such as a busier-than-usual enterprise, start as "Needs attention" instead,
 * since IT is not involved in them.
 */
export type RequestProgress = "attention" | "seen" | "in-progress" | "resolved";
export type RequestKind = "alert" | "ticket" | "account";
export type RequestSourceType = "operational.alert" | "support.ticket" | "enterprise.profile";

export type AdminRequest = {
  /** Unique across sources, for example `ticket:<id>` or `account:<accountId>:contactNumber`. */
  key: string;
  kind: RequestKind;
  sourceType: RequestSourceType;
  /** The alert code, ticket id or enterprise account id. */
  sourceId: string;
  /** Which profile change, when an account has two. */
  changeType: ProfileChangeRequestType | null;
  type: RequestType;
  title: string;
  place: string;
  enterpriseId: string | null;
  sentBy: string;
  /** First name of the enterprise contact, for the "Call the enterprise" instruction. */
  contactFirstName: string | null;
  reference: string | null;
  progress: RequestProgress;
  /** An alert Admins handle themselves. */
  adminOwned: boolean;
  what: string;
  suggestedAction: string | null;
  area: string | null;
  camera: string | null;
  priority: string | null;
  attachments: SupportTicketAttachment[];
  sentAt: string | null;
  /** Changes whenever the request changes, so a seen request can show as "Updated". */
  version: string;
};

export type RequestFilters = {
  query: string;
  type: RequestType | "all";
  progress: RequestProgress | "all";
};

export const initialRequestFilters: RequestFilters = { query: "", type: "all", progress: "all" };

export const progressLabels: Record<RequestProgress, string> = {
  attention: "Needs attention",
  seen: "Seen by IT",
  "in-progress": "In progress",
  resolved: "Resolved",
};

/** Text colour for each progress, as plain coloured text (the design uses no pills here). */
export const progressTextClass: Record<RequestProgress, string> = {
  attention: "text-(--tanaw-warn-ink)",
  seen: "text-(--tanaw-warn-ink)",
  "in-progress": "text-(--tanaw-accent-ink)",
  resolved: "text-(--tanaw-text-secondary)",
};

export const progressDotClass: Record<RequestProgress, string> = {
  attention: "bg-(--tanaw-warn-ink)",
  seen: "bg-(--tanaw-warn-ink)",
  "in-progress": "bg-(--tanaw-accent-ink)",
  resolved: "bg-(--tanaw-text-secondary)",
};

const ticketTypes: Record<string, RequestType> = {
  "Camera Issue": "Camera issue",
  "Report Concern": "Report concern",
  Maintenance: "Desktop app and maintenance",
  "Account & Security": "Account and access",
  Other: "Other",
};

const alertTypes: Record<PriorityAlertType, RequestType> = {
  "Maintenance Request": "Desktop app and maintenance",
  "Password Reset Request": "Account and access",
  "Failed Login Threshold": "Account and access",
  "Submission Delay": "Report concern",
  "Foot Traffic Alert": "Other",
  "Occupancy Spike": "Other",
};

const alertTitles: Record<PriorityAlertType, string> = {
  "Maintenance Request": "Desktop app or camera problem",
  "Password Reset Request": "Password reset request",
  "Failed Login Threshold": "Account locked after failed sign-ins",
  "Submission Delay": "Late enterprise report",
  "Foot Traffic Alert": "Busier than usual",
  "Occupancy Spike": "Sudden rise in visitors",
};

/** Alerts TANAW raises by itself rather than a person asking for help. */
const automaticAlertTypes = new Set<PriorityAlertType>(["Foot Traffic Alert", "Occupancy Spike", "Submission Delay", "Failed Login Threshold"]);

export function ticketRequestType(category: string): RequestType {
  return ticketTypes[category] ?? "Other";
}

export function alertRequestType(type: PriorityAlertType): RequestType {
  return alertTypes[type] ?? "Other";
}

/** New / Open → Seen by IT, In Review → In progress, Resolved → Resolved. */
export function statusProgress(status: string, adminOwned = false): RequestProgress {
  if (status === "Resolved") return "resolved";
  if (status === "In Review") return "in-progress";
  return adminOwned ? "attention" : "seen";
}

export function alertToRequest(alert: PriorityAlert, enterpriseIdsByName: ReadonlyMap<string, string> = new Map()): AdminRequest {
  const adminOwned = alert.owner === "Admin";
  const place = alert.enterprise ?? alert.requester;
  return {
    key: `alert:${alert.id}`,
    kind: "alert",
    sourceType: "operational.alert",
    sourceId: alert.id,
    changeType: null,
    type: alertRequestType(alert.type),
    title: alertTitles[alert.type] ?? alert.type,
    place,
    enterpriseId: alert.enterprise ? (enterpriseIdsByName.get(normalizeName(alert.enterprise)) ?? null) : null,
    sentBy: automaticAlertTypes.has(alert.type) ? "TANAW, automatic alert" : alert.requester,
    contactFirstName: null,
    reference: alert.id,
    progress: statusProgress(alert.status, adminOwned),
    adminOwned,
    what: alert.summary,
    suggestedAction: alert.requiredAction || null,
    area: null,
    camera: null,
    priority: alert.urgency,
    attachments: [],
    sentAt: alert.time || null,
    version: alert.status,
  };
}

export function ticketToRequest(ticket: SupportTicket, accountsByEnterpriseId: ReadonlyMap<string, AccountSummary> = new Map()): AdminRequest {
  const account = accountsByEnterpriseId.get(ticket.enterpriseId);
  const manager = account?.managerName?.trim() || null;
  return {
    key: `ticket:${ticket.id}`,
    kind: "ticket",
    sourceType: "support.ticket",
    sourceId: ticket.id,
    changeType: null,
    type: ticketRequestType(ticket.category),
    title: ticket.subject,
    place: ticket.enterpriseName,
    enterpriseId: ticket.enterpriseId || null,
    sentBy: manager ? `${manager}, ${ticket.enterpriseName}` : ticket.submittedBy,
    contactFirstName: firstName(manager),
    reference: ticket.code,
    progress: statusProgress(ticket.status),
    adminOwned: false,
    what: ticket.description,
    suggestedAction: null,
    area: ticket.affectedArea?.trim() || null,
    camera: ticket.cameraNode?.trim() || null,
    priority: ticket.priority,
    attachments: ticket.attachments ?? [],
    sentAt: ticket.createdAt || null,
    version: `${ticket.status}|${ticket.updatedAt}`,
  };
}

export function profileChangeToRequest(account: AccountSummary, change: AccountProfileChangeRequest): AdminRequest {
  const place = account.enterpriseName ?? account.displayName;
  const manager = account.managerName?.trim() || null;
  const label = change.label.toLowerCase();
  return {
    key: `account:${account.id}:${change.type}`,
    kind: "account",
    sourceType: "enterprise.profile",
    sourceId: account.id,
    changeType: change.type,
    type: "Account and access",
    title: `Change of ${label}`,
    place,
    enterpriseId: account.enterpriseId,
    sentBy: manager ? `${manager}, ${place}` : place,
    contactFirstName: firstName(manager),
    reference: change.requestId,
    progress: "seen",
    adminOwned: false,
    what: `${place} asked to change its ${label} to ${change.requestedValue}. ${profileChangeStatusSentence(change)}`,
    suggestedAction: null,
    area: null,
    camera: null,
    priority: null,
    attachments: [],
    sentAt: change.requestedAt,
    version: `${change.status}|${change.requestedValue}|${change.requestedAt ?? ""}`,
  };
}

function profileChangeStatusSentence(change: AccountProfileChangeRequest) {
  if (change.status === "pending_verification") return "The new address has not been verified yet.";
  if (change.status === "verified") return "The new address is verified and is waiting for IT to approve it.";
  if (change.status === "expired") return "The verification link expired before it was used.";
  return "It is waiting for IT to approve it.";
}

/** Merges every source into one list, newest first. */
export function buildAdminRequests({ alerts, tickets, accounts }: { alerts: readonly PriorityAlert[]; tickets: readonly SupportTicket[]; accounts: readonly AccountSummary[] }): AdminRequest[] {
  const accountsByEnterpriseId = new Map<string, AccountSummary>();
  const enterpriseIdsByName = new Map<string, string>();
  for (const account of accounts) {
    if (account.enterpriseId) accountsByEnterpriseId.set(account.enterpriseId, account);
    if (account.enterpriseId && account.enterpriseName) enterpriseIdsByName.set(normalizeName(account.enterpriseName), account.enterpriseId);
  }
  const requests = [
    ...alerts.map((alert) => alertToRequest(alert, enterpriseIdsByName)),
    ...tickets.map((ticket) => ticketToRequest(ticket, accountsByEnterpriseId)),
    ...accounts.flatMap((account) => (account.profileChangeRequests ?? []).map((change) => profileChangeToRequest(account, change))),
  ];
  return requests.sort(compareNewestFirst);
}

export function compareNewestFirst(left: AdminRequest, right: AdminRequest) {
  const leftTime = timestamp(left.sentAt);
  const rightTime = timestamp(right.sentAt);
  if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1;
  return left.key.localeCompare(right.key);
}

export function filterRequests(requests: readonly AdminRequest[], filters: RequestFilters) {
  const query = filters.query.trim().toLowerCase();
  return requests.filter((request) => {
    if (filters.type !== "all" && request.type !== filters.type) return false;
    if (filters.progress !== "all" && request.progress !== filters.progress) return false;
    if (!query) return true;
    return [request.title, request.place, request.reference ?? ""].join(" ").toLowerCase().includes(query);
  });
}

const PROGRESS_VALUES: readonly string[] = ["attention", "seen", "in-progress", "resolved"];

export function isRequestFilters(value: unknown): value is RequestFilters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.query === "string" &&
    (candidate.type === "all" || (REQUEST_TYPES as readonly unknown[]).includes(candidate.type)) &&
    (candidate.progress === "all" || PROGRESS_VALUES.includes(candidate.progress as string))
  );
}

export function hasActiveFilters(filters: RequestFilters) {
  return filters.query.trim() !== "" || filters.type !== "all" || filters.progress !== "all";
}

/** The Progress options: the three IT stages, plus "Needs attention" when Admin-owned alerts are waiting. */
export function progressFilterOptions(requests: readonly AdminRequest[]): Array<readonly [RequestProgress | "all", string]> {
  const options: Array<readonly [RequestProgress | "all", string]> = [
    ["all", "All progress"],
    ["resolved", progressLabels.resolved],
    ["in-progress", progressLabels["in-progress"]],
    ["seen", progressLabels.seen],
  ];
  if (requests.some((request) => request.progress === "attention")) options.push(["attention", progressLabels.attention]);
  return options;
}

export type RequestDayGroup = { key: string; label: string; requests: AdminRequest[] };

/** Groups requests by Philippine calendar day: "Today", "Yesterday", "Nov 21" (with the year when it differs). */
export function groupRequestsByDay(requests: readonly AdminRequest[], now: Date): RequestDayGroup[] {
  const today = philippineDayKey(now);
  const yesterday = philippineDayKey(new Date(now.getTime() - 86_400_000));
  const groups = new Map<string, RequestDayGroup>();
  for (const request of requests) {
    const date = request.sentAt ? new Date(request.sentAt) : null;
    const key = date && !Number.isNaN(date.getTime()) ? philippineDayKey(date) : "undated";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayLabel(key, date, today, yesterday), requests: [] };
      groups.set(key, group);
    }
    group.requests.push(request);
  }
  return [...groups.values()].sort((left, right) => (left.key === "undated" ? 1 : right.key === "undated" ? -1 : right.key.localeCompare(left.key)));
}

function dayLabel(key: string, date: Date | null, today: string, yesterday: string) {
  if (key === "undated" || !date) return "Date not recorded";
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "2026-11-23" for a moment, in Philippine time. */
export function philippineDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "2:05 PM" (or "14:05"), in Philippine time. */
export function formatRequestTime(value: string | null, timeFormat: SystemTimeFormat) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "Just now", "2:05 PM" today, or "Nov 21, 2:05 PM" on another day. */
export function formatRequestWhen(value: string | null, now: Date, timeFormat: SystemTimeFormat) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const age = now.getTime() - date.getTime();
  if (age >= 0 && age < 60_000) return "Just now";
  const time = formatRequestTime(value, timeFormat);
  if (philippineDayKey(date) === philippineDayKey(now)) return time;
  const sameYear = philippineDayKey(date).slice(0, 4) === philippineDayKey(now).slice(0, 4);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: PHILIPPINE_TIME_ZONE }).format(date);
  return `${day}, ${time}`;
}

/** Query parameters that select a request: `alert`, `ticket`, or `account` with `change` for one of two profile changes. */
export function requestSearchParams(request: AdminRequest): Record<string, string> {
  if (request.kind === "alert") return { alert: request.sourceId };
  if (request.kind === "ticket") return { ticket: request.sourceId };
  return request.changeType ? { account: request.sourceId, change: request.changeType } : { account: request.sourceId };
}

export const REQUEST_LINK_PARAMS = ["alert", "ticket", "account", "change"] as const;

/** The request a deep link names, if it is in the list. */
export function findLinkedRequest(requests: readonly AdminRequest[], params: URLSearchParams): AdminRequest | null {
  const alertId = params.get("alert");
  if (alertId) return requests.find((request) => request.kind === "alert" && request.sourceId === alertId) ?? null;
  const ticketId = params.get("ticket");
  if (ticketId) return requests.find((request) => request.kind === "ticket" && request.sourceId === ticketId) ?? null;
  const accountId = params.get("account");
  if (accountId) {
    const change = params.get("change");
    const matches = requests.filter((request) => request.kind === "account" && request.sourceId === accountId);
    return matches.find((request) => request.changeType === change) ?? matches[0] ?? null;
  }
  return null;
}

export function hasRequestLink(params: URLSearchParams) {
  return Boolean(params.get("alert") || params.get("ticket") || params.get("account"));
}

export type QuickInstruction = { label: string; text: string };

/** Ready-made messages for the Message IT composer. */
export function quickInstructions(request: Pick<AdminRequest, "place" | "contactFirstName">): QuickInstruction[] {
  return [
    { label: "Send someone on site", text: `Can someone go to ${request.place} today to check this in person, please?` },
    {
      label: "Call the enterprise",
      text: request.contactFirstName ? `Please call ${request.contactFirstName} at ${request.place} to get more details about this.` : `Please call ${request.place} to get more details about this.`,
    },
    { label: "Check remotely first", text: "Can you check this remotely first? Let me know if someone needs to go on site." },
    { label: "Update me when done", text: "Please update me here as soon as this is fixed." },
  ];
}

function firstName(name: string | null) {
  return name?.split(/\s+/)[0] || null;
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function timestamp(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
