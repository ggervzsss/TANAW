import { compareNewestFirst, philippineDayKey, requestPlace } from "@/features/alerts-monitor/model";
import type { EnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { REQUEST_GROUPS, type AccountChange, type Request, type RequestDetail, type RequestGroup } from "@/shared/services/requests";
import { formatPhilippineDate, formatPhilippineDateAndTime, formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * IT Requests (`/it/requests`): help and approval requests from enterprises and the sign-in page.
 * Only IT changes a request's status; the Admin can add notes. An open request nobody in IT has
 * started on is "not picked up". The filters and the selected request live in the address.
 */

export const REQUEST_PARAM = "request";
export const SEARCH_PARAM = "q";
export const TYPE_PARAM = "type";
export const STATUS_PARAM = "status";
export const OWNER_PARAM = "owner";

// Filters

export type StatusFilter = "open" | "not-picked-up" | "in-progress" | "resolved" | "approved" | "all";
export type TypeFilter = "all" | RequestGroup;
/** "anyone", "me", or an IT person's account ID. */
export type OwnerFilter = string;

export type ItRequestFilters = { query: string; type: TypeFilter; status: StatusFilter; owner: OwnerFilter };

export const defaultFilters: ItRequestFilters = { query: "", type: "all", status: "open", owner: "anyone" };

export const statusFilterOptions: ReadonlyArray<readonly [StatusFilter, string]> = [
  ["open", "Open"],
  ["not-picked-up", "Not picked up"],
  ["in-progress", "In progress"],
  ["resolved", "Resolved"],
  ["approved", "Approved"],
  ["all", "All statuses"],
];

const TYPE_SLUGS: Record<RequestGroup, string> = {
  "Sign-in help": "sign-in",
  "Desktop app or camera problem": "device",
  "Report problem": "report",
  "Account change": "account-change",
  Other: "other",
};

/** The Type options: [address value, label]. */
export const typeFilterOptions: ReadonlyArray<readonly [string, string]> = [["all", "All types"], ...REQUEST_GROUPS.map((group) => [TYPE_SLUGS[group], group] as const)];

export function typeSlug(type: TypeFilter) {
  return type === "all" ? "all" : TYPE_SLUGS[type];
}

export function typeFromSlug(slug: string | null): TypeFilter {
  return REQUEST_GROUPS.find((group) => TYPE_SLUGS[group] === slug) ?? "all";
}

/** The filters in the address; anything unknown falls back to the default. */
export function parseFilters(params: URLSearchParams): ItRequestFilters {
  const status = params.get(STATUS_PARAM);
  const owner = params.get(OWNER_PARAM)?.trim();
  return {
    query: params.get(SEARCH_PARAM) ?? "",
    type: typeFromSlug(params.get(TYPE_PARAM)),
    status: statusFilterOptions.some(([value]) => value === status) ? (status as StatusFilter) : defaultFilters.status,
    owner: owner || defaultFilters.owner,
  };
}

/** The address with these filters, keeping other parameters (such as the selected request). Defaults are left out. */
export function filtersToParams(filters: ItRequestFilters, current: URLSearchParams) {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string, fallback: string) => (value && value !== fallback ? next.set(key, value) : next.delete(key));
  set(SEARCH_PARAM, filters.query, "");
  set(TYPE_PARAM, typeSlug(filters.type), "all");
  set(STATUS_PARAM, filters.status, defaultFilters.status);
  set(OWNER_PARAM, filters.owner, defaultFilters.owner);
  return next;
}

export function hasActiveFilters(filters: ItRequestFilters) {
  return filters.query.trim() !== "" || filters.type !== "all" || filters.status !== "all" || filters.owner !== "anyone";
}

/** "Clear filters" shows every request. */
export const clearedFilters: ItRequestFilters = { query: "", type: "all", status: "all", owner: "anyone" };

// Status

export type RequestState = "not-picked-up" | "in-progress" | "resolved" | "approved";

export function isOpenRequest(request: Pick<Request, "status">) {
  return request.status === "In Progress";
}

/** Open, and nobody in IT has started on it. */
export function isNotPickedUp(request: Pick<Request, "status" | "handledBy">) {
  return isOpenRequest(request) && !request.handledBy;
}

export function requestState(request: Pick<Request, "status" | "handledBy">): RequestState {
  if (isNotPickedUp(request)) return "not-picked-up";
  if (request.status === "In Progress") return "in-progress";
  if (request.status === "Approved") return "approved";
  return "resolved";
}

export const stateLabels: Record<RequestState, string> = {
  "not-picked-up": "Not picked up",
  "in-progress": "In progress",
  resolved: "Resolved",
  approved: "Approved",
};

export const stateTextClass: Record<RequestState, string> = {
  "not-picked-up": "text-(--tanaw-warn-ink)",
  "in-progress": "text-(--tanaw-accent-ink)",
  approved: "text-(--tanaw-accent-ink)",
  resolved: "text-(--tanaw-text-secondary)",
};

export const stateDotClass: Record<RequestState, string> = {
  "not-picked-up": "bg-(--tanaw-warn-ink)",
  "in-progress": "bg-(--tanaw-accent-ink)",
  approved: "bg-(--tanaw-accent-ink)",
  resolved: "bg-(--tanaw-text-secondary)",
};

export function matchesStatus(request: Pick<Request, "status" | "handledBy">, status: StatusFilter) {
  if (status === "all") return true;
  if (status === "open") return isOpenRequest(request);
  return requestState(request) === status;
}

export function matchesOwner(request: Pick<Request, "handledBy">, owner: OwnerFilter, meId: string | null) {
  if (owner === "anyone") return true;
  const handlerId = request.handledBy?.accountId ?? null;
  if (owner === "me") return Boolean(meId) && handlerId === meId;
  return handlerId === owner;
}

export function matchesQuery(request: Request, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [request.title, request.code, requestPlace(request), request.requesterName, request.enterpriseName ?? "", request.group, request.description].join(" ").toLowerCase().includes(needle);
}

/** The requests these filters show, newest first. */
export function filterItRequests(requests: readonly Request[], filters: ItRequestFilters, meId: string | null) {
  return requests
    .filter(
      (request) =>
        (filters.type === "all" || request.group === filters.type) && matchesStatus(request, filters.status) && matchesOwner(request, filters.owner, meId) && matchesQuery(request, filters.query),
    )
    .sort(compareNewestFirst);
}

/** Handled by: Anyone, Me, then each other IT person seen handling a request, by name. */
export function ownerFilterOptions(requests: readonly Request[], meId: string | null, selected: OwnerFilter = "anyone"): Array<readonly [string, string]> {
  const people = new Map<string, string>();
  for (const request of requests) {
    const handler = request.handledBy;
    if (handler && handler.accountId !== meId && !people.has(handler.accountId)) people.set(handler.accountId, handler.name);
  }
  const options: Array<readonly [string, string]> = [["anyone", "Anyone"], ["me", "Me"], ...[...people.entries()].sort((left, right) => left[1].localeCompare(right[1]))];
  if (!options.some(([value]) => value === selected)) options.push([selected, "Another IT person"]);
  return options;
}

export function countNotPickedUp(requests: readonly Pick<Request, "status" | "handledBy">[]) {
  return requests.filter(isNotPickedUp).length;
}

export function notPickedUpLabel(count: number) {
  return count === 0 ? "Every request is picked up" : `${count} not picked up yet`;
}

export function listSummary(count: number) {
  return `${count} ${count === 1 ? "request" : "requests"}, newest first.`;
}

/** The selected request from `?request=` (ID or reference number). */
export function findSelectedRequest(requests: readonly Request[], params: URLSearchParams) {
  const id = params.get(REQUEST_PARAM);
  return id ? (requests.find((request) => request.id === id || request.code === id) ?? null) : null;
}

// Days and times

export type RequestDayGroup = { key: string; label: string; requests: Request[] };

/** Requests under day headings: Today, Yesterday, then the date in the system date format. */
export function groupByDay(requests: readonly Request[], now: Date, dateFormat: SystemDateFormat): RequestDayGroup[] {
  const today = philippineDayKey(now);
  const yesterday = philippineDayKey(new Date(now.getTime() - 86_400_000));
  const groups = new Map<string, RequestDayGroup>();
  for (const request of requests) {
    const date = new Date(request.createdAt);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? philippineDayKey(date) : "undated";
    let group = groups.get(key);
    if (!group) {
      const label = !valid ? "Date unavailable" : key === today ? "Today" : key === yesterday ? "Yesterday" : formatPhilippineDate(date, dateFormat);
      group = { key, label, requests: [] };
      groups.set(key, group);
    }
    group.requests.push(request);
  }
  return [...groups.values()];
}

/** "Just now", "3:15 PM" today, or the date and time on other days. */
export function formatWhen(value: string | null | undefined, now: Date, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const age = now.getTime() - date.getTime();
  if (age >= 0 && age < 60_000) return "Just now";
  if (philippineDayKey(date) === philippineDayKey(now)) return formatPhilippineTime(date, timeFormat);
  return formatPhilippineDateAndTime(date, dateFormat, timeFormat);
}

// People

export type Viewer = { id: string | null; name: string | null };

export function isMine(request: Pick<Request, "handledBy">, viewer: Viewer) {
  return Boolean(viewer.id && request.handledBy?.accountId === viewer.id);
}

/** In the list: "You" or the IT person's name, or nothing. */
export function ownerShort(request: Pick<Request, "handledBy">, viewer: Viewer) {
  if (!request.handledBy) return "";
  return isMine(request, viewer) ? "You" : request.handledBy.name;
}

/** Handled by: "You (Ana Reyes)", "Carlo Mendoza", or "Not picked up yet". */
export function handledByLabel(request: Pick<Request, "status" | "handledBy">, viewer: Viewer) {
  const handler = request.handledBy;
  if (!handler) return isOpenRequest(request) ? "Not picked up yet" : "IT";
  return isMine(request, viewer) ? `You (${handler.name})` : handler.name;
}

/** The sender's first name or name, for "Reply to Nora". */
export function senderName(request: Pick<Request, "requesterName">) {
  return request.requesterName.split(",")[0]?.trim() || request.requesterName;
}

/** The sentence under the title. `when` formats a timestamp. */
export function statusNote(request: Request, viewer: Viewer, when: (value: string) => string) {
  const state = requestState(request);
  if (state === "not-picked-up") return "Nobody in IT has picked this up yet. The sender is waiting.";
  const mine = isMine(request, viewer);
  const who = request.handledBy ? (mine ? "you" : request.handledBy.name) : "IT";
  const Who = who === "you" ? "You" : who;
  if (state === "in-progress") {
    const at = request.handledAt ? ` at ${when(request.handledAt)}` : "";
    return mine ? `You started on this${at}.` : `${Who} started on this${at}. You can still reply or help.`;
  }
  const at = request.closedAt ? ` at ${when(request.closedAt)}` : "";
  if (state === "approved") return `Approved by ${who}${at}. The change is now in use.`;
  if (request.accountChange) return `Declined by ${who}${at}. The old ${request.accountChange.label.toLowerCase()} stays.`;
  return `Resolved by ${who}${at}. You or the sender can reopen it.`;
}

// Actions

export function isAccountChange(request: Pick<Request, "group" | "accountChange">) {
  return Boolean(request.accountChange) || request.group === "Account change";
}

export type RequestActions = {
  canStart: boolean;
  /** Approve change and Decline. */
  canDecide: boolean;
  canResolve: boolean;
  canReopen: boolean;
  canMove: boolean;
  canReply: boolean;
};

export function requestActions(request: Request): RequestActions {
  const open = isOpenRequest(request);
  const account = isAccountChange(request);
  return {
    canStart: isNotPickedUp(request),
    canDecide: open && account,
    canResolve: open && !account,
    // A decided account change stays decided; the server refuses to reopen it.
    canReopen: request.status === "Resolved" && !account,
    canMove: open && !account,
    canReply: open,
  };
}

/** Why "Approve change" is unavailable, or null when IT can approve it. */
export function approveBlockedReason(change: AccountChange | null | undefined): string | null {
  if (!change || change.canApprove) return null;
  if (change.verification === "pending_verification") return "The new email address is not verified yet, so the change can't be approved.";
  if (change.verification === "expired") return "The verification link expired before it was used, so the change can't be approved. Decline it and ask them to send it again.";
  return "This change can't be approved now.";
}

/** Move to another type: every type except Account change, which only account changes belong to. */
export function moveOptions(request: Pick<Request, "group">): Array<{ group: RequestGroup; selected: boolean }> {
  return REQUEST_GROUPS.filter((group) => group !== "Account change").map((group) => ({ group, selected: group === request.group }));
}

export type QuickReply = { label: string; text: string };

/** Ready-made replies: one set for account changes, one for device and other problems. */
export function quickReplies(request: Pick<Request, "group" | "accountChange">): QuickReply[] {
  if (isAccountChange(request)) {
    const change = request.accountChange;
    const what = change ? change.label.toLowerCase() : "details";
    const replies: QuickReply[] = [{ label: "Ask for proof", text: `Please send a photo of the document that shows the new ${what}.` }];
    if (change?.field === "contactNumber") replies.push({ label: "Number not reachable", text: "We could not reach the new number. Please check it and send the change again." });
    if (change?.field === "businessEmail") replies.push({ label: "Verify the email", text: "Please open the link we sent to the new email address so we can approve the change." });
    return replies;
  }
  return [
    { label: "Restart the app", text: "Please close the TANAW desktop app, wait 10 seconds and open it again. Tell us if the problem comes back." },
    { label: "Check the cable", text: "Please check that the camera power and network cables are pushed in all the way." },
    { label: "Looking into it", text: "Thanks for reporting this. I am looking into it now and will update you here." },
  ];
}

export function replyHint(request: Request) {
  if (requestActions(request).canDecide) return "Your reply goes to the sender and shows in the conversation. To decline, write the reason here first.";
  return "Your reply goes to the sender and shows in the conversation. Admin can read it too.";
}

// Conversation and updates

export type TimelineKind = "sent" | "progress" | "approved" | "resolved" | "reopened" | "reply" | "message" | "note";

export type TimelineEntry = { id: string; title: string; at: string | null; detail: string; kind: TimelineKind };

function messageEntry(message: NonNullable<RequestDetail["messages"]>[number], request: Pick<Request, "group" | "accountChange">): TimelineEntry {
  const base = { id: message.id, at: message.createdAt };
  const name = message.authorName;
  if (message.kind === "status") {
    if (message.message.endsWith("started on it.")) return { ...base, title: "In progress", kind: "progress", detail: message.message };
    if (message.message === "Approved") return { ...base, title: "Approved", kind: "approved", detail: `${name} approved the change. It is now in use.` };
    if (message.message === "Resolved") {
      return isAccountChange(request)
        ? { ...base, title: "Declined", kind: "resolved", detail: `${name} declined the change. The old value stays.` }
        : { ...base, title: "Resolved", kind: "resolved", detail: `${name} marked it resolved.` };
    }
    if (message.message === "Reopened") return { ...base, title: "Reopened", kind: "reopened", detail: `${name} reopened it.` };
    if (message.message === "In Progress") return { ...base, title: "In progress", kind: "progress", detail: `${name} set it back to in progress.` };
    return { ...base, title: message.message, kind: "progress", detail: `${name} changed the status.` };
  }
  if (message.kind === "note") return { ...base, title: `Note from ${name}, Admin`, kind: "note", detail: message.message };
  if (message.authorRole === "it") return { ...base, title: "Reply from IT", kind: "reply", detail: `${name}: ${message.message}` };
  return { ...base, title: `Message from ${name}`, kind: "message", detail: message.message };
}

/** How the request arrived, for the last timeline entry. */
export function sentDetail(request: Pick<Request, "group" | "accountChange" | "attachments">) {
  const photos = request.attachments?.length ?? 0;
  const withPhotos = photos > 0 ? `, with ${photos} ${photos === 1 ? "photo" : "photos"}` : "";
  if (request.group === "Sign-in help") return `Sent from Contact support on the sign-in page${withPhotos}.`;
  if (request.accountChange) return `Sent by TANAW when the ${request.accountChange.label.toLowerCase()} was edited in the desktop app.`;
  return `Sent from the desktop app${withPhotos}.`;
}

/** Every update, newest first, ending with when the request was sent. */
export function buildTimeline(request: Request, detail: Pick<RequestDetail, "messages"> | null): TimelineEntry[] {
  const entries = (detail?.messages ?? []).map((message) => messageEntry(message, request)).sort((left, right) => sortTime(right.at) - sortTime(left.at) || right.id.localeCompare(left.id));
  return [...entries, { id: "sent", title: "Request sent", at: request.createdAt, detail: sentDetail(request), kind: "sent" }];
}

// Details

export function areaAndCamera(request: Pick<Request, "affectedArea" | "camera">) {
  return [request.affectedArea, request.camera].filter((part) => part && part.trim()).join(", ") || "Not given";
}

export type AppTone = "ok" | "warn" | "danger" | "muted";

/** The Desktop app line from the place's health. */
export function desktopAppStatus(health: EnterpriseHealth, now: Date, when: (value: string) => string): { label: string; tone: AppTone } {
  if (health.accountState === "deactivated") return { label: "Account deactivated", tone: "muted" };
  if (health.accountState === "invited") return { label: "Invitation not accepted yet", tone: "muted" };
  if (health.accountState === "expired") return { label: "Invitation expired", tone: "warn" };
  const app = health.app;
  if (app.status === "not_set_up") return { label: "Not set up yet", tone: "muted" };
  if (health.openNow === false) return { label: health.closedReason ? `Closed now (${health.closedReason})` : "Closed now", tone: "muted" };
  if (app.status === "online") return { label: app.computerName ? `Online on ${app.computerName}` : "Online", tone: "ok" };
  const last = app.lastDataAt ? lastDataText(app.lastDataAt, now, when) : null;
  if (app.status === "delayed") return { label: last ? `Delayed, last data ${last}` : "Delayed", tone: "warn" };
  return { label: last ? `Offline, last data ${last}` : "Offline", tone: "danger" };
}

function lastDataText(value: string, now: Date, when: (value: string) => string) {
  const minutes = Math.floor((now.getTime() - Date.parse(value)) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return when(value);
}

export const appToneClass: Record<AppTone, string> = {
  ok: "text-(--tanaw-accent-ink)",
  warn: "text-(--tanaw-warn-ink)",
  danger: "text-(--tanaw-danger)",
  muted: "text-(--tanaw-text-secondary)",
};

/** The link to manage a place, until the shared route helper exists. */
export function itEnterpriseLink(enterpriseId: string) {
  return `/it/enterprises/${encodeURIComponent(enterpriseId)}`;
}

function sortTime(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
