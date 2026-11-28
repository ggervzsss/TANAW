import { isClosedRequest, type Request, type RequestGroup } from "@/shared/services/requests";
import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * Admin Requests (`/admin/requests`): every request people sent to IT, newest first. The Admin
 * reads them all and can add a note for IT, but IT handles them. Read marks come from the server,
 * so they are the same on every device.
 */

export const REQUEST_PARAM = "request";

/*
 * Type: the Admin's categories, worked out from a request's group and whether it names a camera.
 * The groups themselves (what IT sees and the server stores) stay as they are.
 */
export type RequestCategory = "Camera Issue" | "Report Concern" | "Account and Access" | "Desktop app and Maintenance" | "Others";

export const REQUEST_CATEGORIES: readonly RequestCategory[] = ["Camera Issue", "Report Concern", "Account and Access", "Desktop app and Maintenance", "Others"];

const GROUP_CATEGORIES: Record<RequestGroup, RequestCategory> = {
  "Desktop app or camera problem": "Desktop app and Maintenance",
  "Report problem": "Report Concern",
  "Sign-in help": "Account and Access",
  "Account change": "Account and Access",
  Other: "Others",
};

/** A desktop app or camera problem that names a camera is a Camera Issue; every other group maps one to one. */
export function requestCategory(request: Pick<Request, "group" | "camera">): RequestCategory {
  if (request.group === "Desktop app or camera problem" && request.camera?.trim()) return "Camera Issue";
  return GROUP_CATEGORIES[request.group];
}

/*
 * Progress: how far IT has got. Resolved (closed, approved changes included), In Progress (someone
 * in IT is handling it) or Seen by IT (opened by IT, nobody handling it yet). An open request
 * nobody in IT has opened is "Sent to IT" and matches none of the three Progress options.
 */
export type RequestProgress = "Resolved" | "In Progress" | "Seen by IT";

export const REQUEST_PROGRESS: readonly RequestProgress[] = ["Resolved", "In Progress", "Seen by IT"];

export function requestProgress(request: Pick<Request, "status" | "handledBy" | "seenByIt">): RequestProgress | null {
  if (isClosedRequest(request)) return "Resolved";
  if (request.handledBy) return "In Progress";
  if (request.seenByIt) return "Seen by IT";
  return null;
}

export type RequestProgressState = RequestProgress | "Sent to IT";

/** The progress a request's row and details show, "Sent to IT" included. */
export function requestProgressState(request: Pick<Request, "status" | "handledBy" | "seenByIt">): RequestProgressState {
  return requestProgress(request) ?? "Sent to IT";
}

export const progressTextClass: Record<RequestProgressState, string> = {
  "Sent to IT": "text-(--tanaw-warn-ink)",
  "Seen by IT": "text-(--tanaw-text)",
  "In Progress": "text-(--tanaw-accent-ink)",
  Resolved: "text-(--tanaw-text-secondary)",
};

export const progressDotClass: Record<RequestProgressState, string> = {
  "Sent to IT": "bg-(--tanaw-warn-ink)",
  "Seen by IT": "bg-(--tanaw-text)",
  "In Progress": "bg-(--tanaw-accent-ink)",
  Resolved: "bg-(--tanaw-text-secondary)",
};

export type RequestFilters = {
  query: string;
  category: "all" | RequestCategory;
  progress: "all" | RequestProgress;
};

export const initialRequestFilters: RequestFilters = { query: "", category: "all", progress: "all" };

export const categoryFilterOptions: Array<readonly [RequestFilters["category"], string]> = [["all", "All types"], ...REQUEST_CATEGORIES.map((category) => [category, category] as const)];

/** Every progress option, even one no request is in right now, so the list stays put. */
export const progressFilterOptions: Array<readonly [RequestFilters["progress"], string]> = [["all", "All progress"], ...REQUEST_PROGRESS.map((progress) => [progress, progress] as const)];

export function isRequestFilters(value: unknown): value is RequestFilters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.query === "string" &&
    (candidate.category === "all" || REQUEST_CATEGORIES.includes(candidate.category as RequestCategory)) &&
    (candidate.progress === "all" || REQUEST_PROGRESS.includes(candidate.progress as RequestProgress))
  );
}

export function hasActiveFilters(filters: RequestFilters) {
  return filters.query.trim() !== "" || filters.category !== "all" || filters.progress !== "all";
}

/** The place a request is about: the enterprise, or the person who asked for sign-in help. */
export function requestPlace(request: Pick<Request, "enterpriseName" | "requesterName">) {
  return request.enterpriseName ?? request.requesterName;
}

export function filterRequests(requests: readonly Request[], filters: RequestFilters) {
  const query = filters.query.trim().toLowerCase();
  return requests
    .filter((request) => filters.category === "all" || requestCategory(request) === filters.category)
    .filter((request) => filters.progress === "all" || requestProgress(request) === filters.progress)
    .filter((request) => !query || [request.title, request.code, requestPlace(request), request.requesterName, requestCategory(request), request.description].join(" ").toLowerCase().includes(query))
    .sort(compareNewestFirst);
}

export function compareNewestFirst(left: Request, right: Request) {
  return timestamp(right.createdAt) - timestamp(left.createdAt) || left.code.localeCompare(right.code);
}

/** "New" for a request the reader never opened, "Updated" for one that changed since. */
export function requestMarker(request: Pick<Request, "unread" | "updated">): "New" | "Updated" | null {
  if (request.unread) return "New";
  if (request.updated) return "Updated";
  return null;
}

export function countUnread(requests: readonly Request[]) {
  return requests.filter((request) => requestMarker(request) !== null).length;
}

export function unreadLabel(count: number) {
  if (count === 0) return "All caught up";
  return `${count} unread`;
}

export function findLinkedRequest(requests: readonly Request[], params: URLSearchParams) {
  const id = params.get(REQUEST_PARAM);
  return id ? (requests.find((request) => request.id === id || request.code === id) ?? null) : null;
}

export type RequestDayGroup = { key: string; label: string; requests: Request[] };

/** Requests under day headings: Today, Yesterday, then "Nov 21". */
export function groupRequestsByDay(requests: readonly Request[], now: Date): RequestDayGroup[] {
  const today = philippineDayKey(now);
  const yesterday = philippineDayKey(new Date(now.getTime() - 86_400_000));
  const groups = new Map<string, RequestDayGroup>();
  for (const request of requests) {
    const date = new Date(request.createdAt);
    const key = Number.isNaN(date.getTime()) ? "undated" : philippineDayKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayLabel(key, date, today, yesterday), requests: [] };
      groups.set(key, group);
    }
    group.requests.push(request);
  }
  return [...groups.values()];
}

function dayLabel(key: string, date: Date, today: string, yesterday: string) {
  if (key === "undated") return "Date unavailable";
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

export function philippineDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

export function formatRequestTime(value: string | null | undefined, timeFormat: SystemTimeFormat) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "Just now", "3:15 PM" today, or "Nov 21, 3:15 PM". */
export function formatRequestWhen(value: string | null | undefined, now: Date, timeFormat: SystemTimeFormat) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (now.getTime() - date.getTime() < 60_000 && now.getTime() >= date.getTime()) return "Just now";
  const time = formatRequestTime(value, timeFormat);
  if (philippineDayKey(date) === philippineDayKey(now)) return time;
  const sameYear = philippineDayKey(date).slice(0, 4) === philippineDayKey(now).slice(0, 4);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: PHILIPPINE_TIME_ZONE }).format(date);
  return `${day}, ${time}`;
}

export type QuickInstruction = { label: string; text: string };

/** Ready-made notes for IT. */
export function quickInstructions(request: Pick<Request, "enterpriseName" | "requesterName">): QuickInstruction[] {
  const place = requestPlace(request);
  return [
    { label: "Send someone on site", text: `Can someone go to ${place} today to check this in person, please?` },
    { label: "Call the enterprise", text: `Please call ${place} about this and let me know what they say.` },
    { label: "Check remotely first", text: "Can you check this remotely first? Let me know if someone needs to go on site." },
    { label: "Update me when done", text: "Please update me here as soon as this is fixed." },
  ];
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
