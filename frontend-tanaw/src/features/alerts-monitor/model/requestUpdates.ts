/*
 * "Latest updates" and the people handling a request, read from the activity history the Admin can
 * see (`/activity-logs`) and, for a support ticket, its conversation. Admin messages to IT are
 * activity records with the action "Message IT" and the message in their metadata.
 */
import type { SupportTicketDetail } from "@/shared/services/supportTickets";
import type { SystemLog } from "@/shared/types";
import type { AdminRequest } from "./adminRequests";

export const MESSAGE_IT_ACTION = "Message IT";

/** The dot colour in the timeline: sent and notes in Civic Green, the rest by outcome. */
export type RequestUpdateKind = "sent" | "note" | "accepted" | "resolved" | "declined" | "review";

export type RequestUpdate = {
  id: string;
  title: string;
  at: string | null;
  detail: string;
  kind: RequestUpdateKind;
};

const PROFILE_ACTIONS = new Set(["Approve Enterprise Profile Change", "Decline Enterprise Profile Change", "Approve Verified Email Change", "Decline Verified Email Change"]);
const SUBMISSION_ACTIONS = new Set(["Submit Support Ticket", "Submit Important Support Request", "Alert Created"]);

/** The activity records about one request. */
export function requestLogs(request: AdminRequest, logs: readonly SystemLog[]): SystemLog[] {
  return logs.filter((log) => {
    if (request.kind === "alert") {
      // Status changes are recorded against the alert's internal id, so match its code in the summary too.
      return log.sourceId === request.sourceId || (log.action.startsWith("Alert ") && log.summary.includes(request.sourceId));
    }
    if (log.sourceId !== request.sourceId) return false;
    if (request.kind === "ticket") return true;
    const isMessage = log.action === MESSAGE_IT_ACTION && log.metadata?.sourceType === "enterprise.profile";
    if (!isMessage && !PROFILE_ACTIONS.has(log.action)) return false;
    return !request.sentAt || Date.parse(log.timestamp) >= Date.parse(request.sentAt);
  });
}

function logStatus(log: SystemLog): string | null {
  if (log.action === "Update Support Ticket Status") return typeof log.metadata?.status === "string" ? log.metadata.status : null;
  if (log.action === "Alert In Review") return "In Review";
  if (log.action === "Alert Resolved" || log.action === "Technical Issue Resolved") return "Resolved";
  if (log.action === "Alert New") return "New";
  return null;
}

function logToUpdate(log: SystemLog): RequestUpdate | null {
  if (SUBMISSION_ACTIONS.has(log.action)) return null;
  const base = { id: `log:${log.id}`, at: log.timestamp };
  if (log.action === MESSAGE_IT_ACTION) {
    const message = typeof log.metadata?.message === "string" ? log.metadata.message : log.summary;
    return { ...base, title: `Message from ${log.actor}`, detail: message, kind: "sent" };
  }
  const isSystem = log.actorRole === "System";
  const status = logStatus(log);
  if (status === "In Review") return { ...base, title: "In progress", detail: `${log.actor} started on this.`, kind: "accepted" };
  if (status === "Resolved") return { ...base, title: "Resolved", detail: isSystem ? log.summary : `${log.actor} marked this resolved.`, kind: "resolved" };
  if (status === "New" || status === "Open") return { ...base, title: "Reopened", detail: `${log.actor} reopened this.`, kind: "review" };
  if (log.action.startsWith("Approve ")) return { ...base, title: "Approved by IT", detail: log.summary, kind: "resolved" };
  if (log.action.startsWith("Decline ")) return { ...base, title: "Declined by IT", detail: log.summary, kind: "declined" };
  return { ...base, title: log.action, detail: log.summary, kind: "note" };
}

/** Every update for a request, newest first, ending with when it was sent. */
export function buildRequestUpdates(request: AdminRequest, logs: readonly SystemLog[], ticket?: SupportTicketDetail | null): RequestUpdate[] {
  const updates = requestLogs(request, logs)
    .map(logToUpdate)
    .filter((update): update is RequestUpdate => update !== null);
  if (request.kind === "ticket" && ticket?.id === request.sourceId) {
    for (const message of ticket.messages ?? []) {
      const fromIt = message.authorRole === "it";
      updates.push({
        id: `message:${message.id}`,
        title: fromIt ? `Reply from ${message.authorName}, IT` : `Message from ${message.authorName}`,
        at: message.createdAt,
        detail: message.message,
        kind: "note",
      });
    }
  }
  updates.sort((left, right) => sortTime(right.at) - sortTime(left.at) || left.id.localeCompare(right.id));
  updates.push(sentUpdate(request));
  return updates;
}

function sentUpdate(request: AdminRequest): RequestUpdate {
  if (request.kind === "alert") {
    const automatic = request.sentBy.startsWith("TANAW");
    return { id: "sent", title: "Alert raised", at: request.sentAt, detail: automatic ? "TANAW raised this alert automatically." : `${request.sentBy} asked for help.`, kind: "sent" };
  }
  if (request.kind === "account") return { id: "sent", title: "Request sent", at: request.sentAt, detail: `${request.sentBy} asked for this change.`, kind: "sent" };
  return { id: "sent", title: "Request sent", at: request.sentAt, detail: `${request.sentBy} sent this request.`, kind: "sent" };
}

export type RequestHandler = { name: string | null; at: string | null };

/** Who moved the request to its current progress and when, from the activity history and IT replies. */
export function requestHandler(request: AdminRequest, logs: readonly SystemLog[], ticket?: SupportTicketDetail | null): RequestHandler {
  const matched = requestLogs(request, logs);
  const wanted = request.progress === "resolved" ? "Resolved" : request.progress === "in-progress" ? "In Review" : null;
  const latest = (items: SystemLog[]) => items.sort((left, right) => sortTime(right.timestamp) - sortTime(left.timestamp))[0];
  const statusLog = wanted ? latest(matched.filter((log) => logStatus(log) === wanted)) : undefined;
  if (statusLog) return { name: statusLog.actorRole === "System" ? null : statusLog.actor, at: statusLog.timestamp };

  const itReplies = request.kind === "ticket" && ticket?.id === request.sourceId ? (ticket.messages ?? []).filter((message) => message.authorRole === "it") : [];
  const firstReply = [...itReplies].sort((left, right) => sortTime(left.createdAt) - sortTime(right.createdAt))[0];
  const lastReply = itReplies.length > 0 ? [...itReplies].sort((left, right) => sortTime(right.createdAt) - sortTime(left.createdAt))[0] : undefined;
  if (request.progress === "in-progress" && firstReply) return { name: firstReply.authorName, at: firstReply.createdAt };
  if (lastReply) return { name: lastReply.authorName, at: null };

  const itLog = latest(matched.filter((log) => log.actorRole === "IT Personnel"));
  return { name: itLog?.actor ?? null, at: null };
}

/** The "Handled by" value. */
export function handledByLabel(request: AdminRequest, handler: RequestHandler) {
  if (request.adminOwned) return handler.name ?? "LGU Admin";
  if (handler.name) return `${handler.name}, IT`;
  return request.progress === "seen" ? "Not accepted yet" : "IT team";
}

/** Who a message to IT reaches, as said in the composer help text. */
export function messageRecipientsLabel(request: AdminRequest, handler: RequestHandler) {
  return !request.adminOwned && handler.name && request.progress !== "seen" ? `${handler.name} and the IT team` : "the IT team";
}

/** The sentence under the title. `formatTime` turns a timestamp into "2:05 PM" or "Nov 21, 2:05 PM". */
export function requestStatusNote(request: AdminRequest, handler: RequestHandler, formatTime: (value: string) => string) {
  const when = handler.at ? formatTime(handler.at) : null;
  if (request.progress === "attention") return "This alert is for Admins to handle. Mark it in progress when someone starts on it.";
  if (request.progress === "seen") return "Sent to IT. The status changes to In progress as soon as IT starts on it.";
  if (request.progress === "in-progress") {
    if (request.adminOwned) return handler.name && when ? `${handler.name} started on this at ${when}.` : "An Admin is working on this.";
    if (handler.name && when) return `${handler.name} from IT started on this at ${when} and is working on it.`;
    return handler.name ? `${handler.name} from IT is working on this.` : "IT is working on this.";
  }
  if (handler.name && when) return `Resolved by ${handler.name} at ${when}.`;
  return when ? `Resolved at ${when}.` : "Resolved.";
}

function sortTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
