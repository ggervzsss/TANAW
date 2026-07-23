import { staffApi } from "../../../lib/axios";

export type SupportTicketCategory = "Camera Issue" | "Report Concern" | "Maintenance" | "Account & Security" | "Other";
export type SupportTicketPriority = "Low" | "Normal" | "High" | "Urgent";
export type SupportTicketStatus = "Open" | "In Review" | "Resolved";

export type SupportTicketAttachment = {
  dataUrl: string;
  fileName: string;
  id?: string | null;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
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

export function canReplyToSupportTicket(ticket: Pick<SupportTicket, "status">) {
  return ticket.status !== "Resolved";
}

export type SupportTicketCreatePayload = {
  affectedArea: string;
  cameraNode?: string | null;
  category: SupportTicketCategory;
  description: string;
  priority: SupportTicketPriority;
  subject: string;
  attachments?: SupportTicketAttachment[];
};

export async function listSupportTickets() {
  const response = await staffApi.get<SupportTicket[]>("/operational/tickets");
  return response.data;
}

export async function getSupportTicket(ticketId: string) {
  const response = await staffApi.get<SupportTicketDetail>(`/operational/tickets/${ticketId}`);
  return response.data;
}

export async function createSupportTicket(payload: SupportTicketCreatePayload) {
  const response = await staffApi.post<SupportTicket>("/operational/tickets", payload);
  return response.data;
}

export async function replyToSupportTicket(ticketId: string, message: string) {
  const response = await staffApi.post<SupportTicketDetail>(`/operational/tickets/${ticketId}/messages`, { message });
  return response.data;
}

export function getSupportTicketAttachmentUrl(attachment: SupportTicketAttachment) {
  if (attachment.dataUrl) {
    return attachment.dataUrl;
  }
  if (attachment.url) {
    const baseUrl = staffApi.defaults.baseURL ?? "http://localhost:8000";
    return attachment.url.startsWith("http") ? attachment.url : new URL(attachment.url, baseUrl).toString();
  }
  return "";
}
