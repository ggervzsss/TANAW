import { apiPaths, type ApiSchemas, type ApiSupportTicket, type ApiSupportTicketCreate, type ApiSupportTicketDetail } from "../../../contracts/api";
import { API_BASE_URL, staffApi } from "../../../lib/axios";

export type SupportTicketCategory = ApiSchemas["SupportTicketCreate"]["category"];
export type SupportTicketPriority = ApiSchemas["SupportTicketCreate"]["priority"];
export type SupportTicketStatus = ApiSchemas["SupportTicketStatusUpdate"]["status"];

export type SupportTicketAttachment = ApiSchemas["SupportTicketAttachmentMetadata"];
export type SupportTicketAttachmentCreate = ApiSchemas["SupportTicketAttachmentCreate"];
export type SupportTicketMessage = ApiSchemas["SupportTicketMessageSummary"];

export type SupportTicket = Omit<ApiSupportTicket, "attachments" | "category" | "priority"> & {
  attachments: SupportTicketAttachment[];
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
};

export type SupportTicketDetail = Omit<ApiSupportTicketDetail, "attachments" | "category" | "messages" | "priority"> & SupportTicket & {
  messages: SupportTicketMessage[];
};

export type SupportTicketSort = "recommended" | "newest" | "oldest" | "priority-high" | "priority-low" | "status" | "recently-updated";

const priorityRank: Record<SupportTicketPriority, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

const workflowRank: Record<SupportTicketStatus, number> = {
  Open: 0,
  "In Review": 1,
  Resolved: 2,
};

export function sortSupportTickets(tickets: readonly SupportTicket[], sort: SupportTicketSort) {
  return [...tickets].sort((left, right) => compareSupportTickets(left, right, sort));
}

export function canReplyToSupportTicket(ticket: Pick<SupportTicket, "status">) {
  return ticket.status !== "Resolved";
}

export type SupportTicketCreatePayload = Omit<ApiSupportTicketCreate, "attachments"> & {
  attachments?: SupportTicketAttachmentCreate[];
};

export async function listSupportTickets() {
  const response = await staffApi.get<SupportTicket[]>(apiPaths.supportTickets);
  return response.data;
}

export async function getSupportTicket(ticketId: string) {
  const response = await staffApi.get<SupportTicketDetail>(`/operational/tickets/${ticketId}`);
  return response.data;
}

export async function createSupportTicket(payload: SupportTicketCreatePayload) {
  const response = await staffApi.post<SupportTicket>(apiPaths.supportTickets, payload);
  return response.data;
}

export async function replyToSupportTicket(ticketId: string, message: string) {
  const response = await staffApi.post<SupportTicketDetail>(`/operational/tickets/${ticketId}/messages`, { message });
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
  if (url.startsWith("/operational/tickets/")) return url;

  try {
    const parsedUrl = new URL(url);
    const apiUrl = new URL(staffApi.defaults.baseURL ?? API_BASE_URL);
    if (parsedUrl.origin === apiUrl.origin && parsedUrl.pathname.startsWith("/operational/tickets/")) {
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
  if (sort === "status") {
    return (
      workflowRank[left.status] - workflowRank[right.status] ||
      priorityRank[left.priority] - priorityRank[right.priority] ||
      compareTimestamp(right.updatedAt, left.updatedAt) ||
      stableTicketOrder(left, right)
    );
  }

  const resolvedDifference = Number(left.status === "Resolved") - Number(right.status === "Resolved");
  return (
    resolvedDifference ||
    (sort === "priority-high" ? priorityRank[left.priority] - priorityRank[right.priority] : priorityRank[right.priority] - priorityRank[left.priority]) ||
    compareTimestamp(right.updatedAt, left.updatedAt) ||
    stableTicketOrder(left, right)
  );
}

function compareRecommended(left: SupportTicket, right: SupportTicket) {
  const resolvedDifference = Number(left.status === "Resolved") - Number(right.status === "Resolved");
  if (resolvedDifference !== 0) return resolvedDifference;
  if (left.status !== "Resolved") {
    const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const statusDifference = workflowRank[left.status] - workflowRank[right.status];
    if (statusDifference !== 0) return statusDifference;
  }
  return compareTimestamp(right.status === "Resolved" ? right.updatedAt : right.createdAt, left.status === "Resolved" ? left.updatedAt : left.createdAt) || stableTicketOrder(left, right);
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
