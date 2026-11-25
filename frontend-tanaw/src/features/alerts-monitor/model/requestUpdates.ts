import type { Request, RequestDetail, RequestMessage } from "@/shared/services/requests";
import { requestPlace } from "./adminRequests";

/*
 * "Latest updates" for a request, from its own timeline: replies, Admin notes for IT and status
 * changes, newest first, ending with when it was sent.
 */

export type RequestUpdateKind = "sent" | "note" | "accepted" | "resolved" | "review";

export type RequestUpdate = { id: string; title: string; at: string | null; detail: string; kind: RequestUpdateKind };

const STATUS_UPDATES: Record<string, { title: string; kind: RequestUpdateKind; detail: (name: string) => string }> = {
  "In Progress": { title: "In progress", kind: "accepted", detail: (name) => `${name} started on this.` },
  Resolved: { title: "Resolved", kind: "resolved", detail: (name) => `${name} marked this resolved.` },
  Approved: { title: "Approved by IT", kind: "resolved", detail: (name) => `${name} approved this change.` },
  Reopened: { title: "Reopened", kind: "review", detail: (name) => `${name} reopened this.` },
};

function messageUpdate(message: RequestMessage): RequestUpdate {
  const base = { id: message.id, at: message.createdAt };
  if (message.kind === "status") {
    const status = STATUS_UPDATES[message.message] ?? { title: message.message, kind: "review" as const, detail: (name: string) => `${name} changed the status.` };
    return { ...base, title: status.title, kind: status.kind, detail: status.detail(message.authorName) };
  }
  if (message.kind === "note") return { ...base, title: `Note for IT from ${message.authorName}`, kind: "sent", detail: message.message };
  if (message.authorRole === "it") return { ...base, title: `Reply from ${message.authorName}, IT`, kind: "note", detail: message.message };
  return { ...base, title: `Message from ${message.authorName}`, kind: "note", detail: message.message };
}

export function sentUpdate(request: Request): RequestUpdate {
  const sender = request.enterpriseName ? `${request.requesterName}, ${request.enterpriseName}` : request.requesterName;
  if (request.group === "Sign-in help") return { id: "sent", title: "Request sent", at: request.createdAt, detail: `${sender} asked for help signing in.`, kind: "sent" };
  if (request.group === "Account change") return { id: "sent", title: "Request sent", at: request.createdAt, detail: `${sender} asked for this change.`, kind: "sent" };
  return { id: "sent", title: "Request sent", at: request.createdAt, detail: `${sender} sent this request.`, kind: "sent" };
}

/** Every update for a request, newest first, ending with when it was sent. */
export function buildRequestUpdates(request: Request, detail: RequestDetail | null): RequestUpdate[] {
  const updates = (detail?.messages ?? []).map(messageUpdate).sort((left, right) => sortTime(right.at) - sortTime(left.at) || left.id.localeCompare(right.id));
  return [...updates, sentUpdate(request)];
}

/** The IT person who last worked on the request, and when IT first acted on it, from its timeline. */
export function requestHandler(detail: RequestDetail | null): { name: string | null; at: string | null } {
  const itEntries = (detail?.messages ?? []).filter((message) => message.authorRole === "it").sort((left, right) => sortTime(right.createdAt) - sortTime(left.createdAt));
  const latest = itEntries[0];
  const first = itEntries.at(-1);
  return { name: latest?.authorName ?? null, at: first?.createdAt ?? null };
}

export function handledByLabel(handler: { name: string | null }) {
  return handler.name ? `${handler.name}, IT` : "IT team";
}

/** The sentence under the title. `formatTime` turns a timestamp into "2:05 PM" or "Nov 21, 2:05 PM". */
export function requestStatusNote(request: Request, handler: { name: string | null; at: string | null }, formatTime: (value: string) => string) {
  const when = handler.at ? formatTime(handler.at) : null;
  if (request.status === "In Progress") {
    if (handler.name && when) return `${handler.name} from IT started on this at ${when}.`;
    return request.group === "Account change" ? "Waiting for IT to approve this change." : "Sent to IT. IT is working on this.";
  }
  if (request.status === "Approved") return `IT approved this change. ${requestPlace(request)}'s details are updated.`;
  if (request.group === "Account change") return handler.name ? `${handler.name} from IT resolved this without approving the change.` : "IT resolved this without approving the change.";
  return handler.name ? `${handler.name} from IT resolved this.` : "IT resolved this.";
}

/** What the account change is, in one sentence, including whether a new email is verified yet. */
export function accountChangeSentence(request: Request) {
  const change = request.accountChange;
  if (!change) return null;
  const from = change.currentValue ? ` from ${change.currentValue}` : "";
  const base = `${change.label}${from} to ${change.requestedValue}.`;
  if (change.verification === "pending_verification") return `${base} The new address is not verified yet, so IT can't approve it.`;
  if (change.verification === "expired") return `${base} The verification link expired before it was used.`;
  if (change.verification === "verified") return `${base} The new address is verified.`;
  return base;
}

function sortTime(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
