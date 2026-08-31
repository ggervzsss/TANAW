import { API_BASE_URL } from "../config/api.config";
import { apiClient } from "../lib/apiClient";

export type SupportTicketCategory = "Camera Issue" | "Report Concern" | "Maintenance" | "Account & Security" | "Other";
export type SupportTicketPriority = "Low" | "Normal" | "High" | "Urgent";
export type SupportTicketStatus = "Open" | "In Review" | "Resolved";

export type SupportTicketAttachment = {
  id: string;
  fileName: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  url: string;
};

export type SupportTicketMessage = {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  message: string;
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  code: string;
  enterpriseId: string;
  enterpriseName: string;
  submittedBy: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  subject: string;
  description: string;
  affectedArea: string | null;
  cameraNode: string | null;
  attachments: SupportTicketAttachment[];
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetail = SupportTicket & {
  messages: SupportTicketMessage[];
};

export const supportTicketsQueryKey = ["operational", "support-tickets"];

export function canReplyToSupportTicket(ticket: Pick<SupportTicket, "status">) {
  return ticket.status !== "Resolved";
}

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

export function compareRecommendedSupportTickets(left: SupportTicket, right: SupportTicket) {
  const resolvedDifference = Number(left.status === "Resolved") - Number(right.status === "Resolved");
  if (resolvedDifference !== 0) return resolvedDifference;

  if (left.status !== "Resolved") {
    const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const statusDifference = workflowRank[left.status] - workflowRank[right.status];
    if (statusDifference !== 0) return statusDifference;
  }

  const leftTimestamp = Date.parse(left.status === "Resolved" ? left.updatedAt : left.createdAt);
  const rightTimestamp = Date.parse(right.status === "Resolved" ? right.updatedAt : right.createdAt);
  const timestampDifference = safeTimestamp(rightTimestamp) - safeTimestamp(leftTimestamp);
  if (timestampDifference !== 0) return timestampDifference;
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}

export function sortRecommendedSupportTickets(tickets: readonly SupportTicket[]) {
  return [...tickets].sort(compareRecommendedSupportTickets);
}

const safeSupportTicketImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function listSupportTickets() {
  const response = await apiClient.get<SupportTicket[]>("/operational/tickets");
  return response.data;
}

export async function getSupportTicket(ticketId: string) {
  const response = await apiClient.get<SupportTicketDetail>(`/operational/tickets/${ticketId}`);
  return response.data;
}

export async function replyToSupportTicket(ticketId: string, message: string) {
  const response = await apiClient.post<SupportTicketDetail>(`/operational/tickets/${ticketId}/messages`, { message });
  return response.data;
}

export async function updateSupportTicketStatus(ticketId: string, status: SupportTicketStatus) {
  const response = await apiClient.patch<SupportTicketDetail>(`/operational/tickets/${ticketId}/status`, { status });
  return response.data;
}

export function isSafeSupportTicketImage(attachment: SupportTicketAttachment) {
  return safeSupportTicketImageTypes.has(attachment.mediaType);
}

export async function fetchSupportTicketAttachmentBlob(attachment: SupportTicketAttachment) {
  if (!isSafeSupportTicketImage(attachment)) {
    throw new Error("This attachment type cannot be previewed.");
  }

  const requestUrl = getSafeAttachmentRequestUrl(attachment.url);
  if (requestUrl) {
    const response = await apiClient.get<Blob>(requestUrl, { responseType: "blob" });
    const contentTypeHeader = response.headers["content-type"];
    const responseType = getBlobMediaType(response.data.type || (typeof contentTypeHeader === "string" ? contentTypeHeader : undefined));
    if (!safeSupportTicketImageTypes.has(responseType)) {
      throw new Error("The attachment response was not a supported image.");
    }
    return response.data;
  }

  throw new Error("Attachment image data is unavailable.");
}

function getSafeAttachmentRequestUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("/operational/tickets/")) return url;

  try {
    const parsedUrl = new URL(url);
    const apiUrl = new URL(API_BASE_URL);
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

function safeTimestamp(value: number) {
  return Number.isFinite(value) ? value : 0;
}
