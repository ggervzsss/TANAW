import { API_BASE_URL } from "../config/api.config";
import { apiClient } from "../lib/apiClient";

export type SupportTicketCategory = "Camera Issue" | "Report Concern" | "Maintenance" | "Account & Security" | "Other";
export type SupportTicketPriority = "Low" | "Normal" | "High" | "Urgent";
export type SupportTicketStatus = "Open" | "In Review" | "Resolved";

export type SupportTicketAttachment = {
  id?: string | null;
  fileName: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  dataUrl?: string;
  url?: string | null;
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

  if (attachment.dataUrl) {
    return dataUrlToBlob(attachment.dataUrl, attachment.mediaType);
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

function dataUrlToBlob(dataUrl: string, expectedMediaType: SupportTicketAttachment["mediaType"]) {
  const prefix = `data:${expectedMediaType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("Attachment image data is invalid.");
  }

  const binary = window.atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: expectedMediaType });
}

function getBlobMediaType(value: string | undefined) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
