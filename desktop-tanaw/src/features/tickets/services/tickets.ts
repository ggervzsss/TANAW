import { apiPaths, type ApiSchemas, type ApiSupportTicket, type ApiSupportTicketCreate, type ApiSupportTicketDetail } from "../../../contracts/api";
import { API_BASE_URL, staffApi } from "../../../lib/axios";

/*
 * Requests (shown as "Requests" on screen): what the enterprise asks IT for. The enterprise picks
 * a group and writes the problem in its own words; there is no priority, IT marks urgency.
 */
export type SupportTicketCategory = ApiSchemas["RequestCreate"]["group"];
export type SupportTicketStatus = ApiSchemas["RequestSummary"]["status"];

export type SupportTicketAttachment = ApiSchemas["RequestAttachmentMetadata"];
export type SupportTicketAttachmentCreate = ApiSchemas["RequestAttachmentCreate"];
export type SupportTicketMessage = ApiSchemas["RequestMessageSummary"];

export type SupportTicket = Omit<ApiSupportTicket, "attachments"> & { attachments: SupportTicketAttachment[] };

export type SupportTicketDetail = Omit<ApiSupportTicketDetail, "attachments" | "messages"> & SupportTicket & {
  messages: SupportTicketMessage[];
};

export type SupportTicketSort = "recommended" | "newest" | "oldest" | "status" | "recently-updated";

const workflowRank: Record<SupportTicketStatus, number> = {
  Sent: 0,
  "In Progress": 1,
  Resolved: 2,
  Approved: 2,
  Declined: 2,
};

export function isClosedRequest(ticket: Pick<SupportTicket, "status">) {
  return ticket.status === "Resolved" || ticket.status === "Approved" || ticket.status === "Declined";
}

export function sortSupportTickets(tickets: readonly SupportTicket[], sort: SupportTicketSort) {
  return [...tickets].sort((left, right) => compareSupportTickets(left, right, sort));
}

export function canReplyToSupportTicket(ticket: Pick<SupportTicket, "status">) {
  return !isClosedRequest(ticket);
}

/** Only a resolved help request can be reopened; an account change is decided once. */
export function canReopenSupportTicket(ticket: Pick<SupportTicket, "status">) {
  return ticket.status === "Resolved";
}

export type SupportTicketCreatePayload = Omit<ApiSupportTicketCreate, "attachments"> & {
  attachments?: SupportTicketAttachmentCreate[];
};

export async function listSupportTickets() {
  const response = await staffApi.get<SupportTicket[]>(apiPaths.supportTickets);
  return response.data;
}

export async function getSupportTicket(ticketId: string) {
  const response = await staffApi.get<SupportTicketDetail>(`/operational/requests/${ticketId}`);
  return response.data;
}

export async function createSupportTicket(payload: SupportTicketCreatePayload) {
  const response = await staffApi.post<SupportTicketDetail>(apiPaths.supportTickets, payload);
  return response.data;
}

export async function replyToSupportTicket(ticketId: string, message: string) {
  const response = await staffApi.post<SupportTicketDetail>(`/operational/requests/${ticketId}/messages`, { message });
  return response.data;
}

export async function reopenSupportTicket(ticketId: string) {
  const response = await staffApi.post<SupportTicketDetail>(`/operational/requests/${ticketId}/reopen`);
  return response.data;
}

const safeSupportTicketImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function fetchSupportTicketAttachmentBlob(attachment: SupportTicketAttachment) {
  const requestUrl = getSafeAttachmentRequestUrl(attachment.url);
  if (!requestUrl) {
    throw new Error("Attachment image data is unavailable.");
  }

  const response = await staffApi.get<Blob>(requestUrl, { responseType: "blob" });
  const contentTypeHeader = response.headers["content-type"];
  const responseType = getBlobMediaType(response.data.type || (typeof contentTypeHeader === "string" ? contentTypeHeader : undefined));
  if (!safeSupportTicketImageTypes.has(responseType)) {
    throw new Error("The attachment response was not a supported image.");
  }
  return response.data;
}

function getSafeAttachmentRequestUrl(url: string) {
  if (url.startsWith("/operational/requests/")) return url;

  try {
    const parsedUrl = new URL(url);
    const apiUrl = new URL(staffApi.defaults.baseURL ?? API_BASE_URL);
    if (parsedUrl.origin === apiUrl.origin && parsedUrl.pathname.startsWith("/operational/requests/")) {
      return parsedUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function getBlobMediaType(value: string | undefined) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function compareSupportTickets(left: SupportTicket, right: SupportTicket, sort: SupportTicketSort) {
  if (sort === "recommended") return compareRecommended(left, right);
  if (sort === "newest") return compareTimestamp(right.createdAt, left.createdAt) || stableTicketOrder(left, right);
  if (sort === "oldest") return compareTimestamp(left.createdAt, right.createdAt) || stableTicketOrder(left, right);
  if (sort === "recently-updated") return compareTimestamp(right.updatedAt, left.updatedAt) || stableTicketOrder(left, right);
  return workflowRank[left.status] - workflowRank[right.status] || compareTimestamp(right.updatedAt, left.updatedAt) || stableTicketOrder(left, right);
}

/** Open requests first (in progress before sent), newest first; closed ones last, latest closed first. */
function compareRecommended(left: SupportTicket, right: SupportTicket) {
  const closedDifference = Number(isClosedRequest(left)) - Number(isClosedRequest(right));
  if (closedDifference !== 0) return closedDifference;
  if (!isClosedRequest(left)) {
    const statusDifference = workflowRank[right.status] - workflowRank[left.status];
    if (statusDifference !== 0) return statusDifference;
  }
  return compareTimestamp(isClosedRequest(right) ? right.updatedAt : right.createdAt, isClosedRequest(left) ? left.updatedAt : left.createdAt) || stableTicketOrder(left, right);
}

function compareTimestamp(left: string, right: string) {
  return safeTimestamp(left) - safeTimestamp(right);
}

function safeTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function stableTicketOrder(left: SupportTicket, right: SupportTicket) {
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}
