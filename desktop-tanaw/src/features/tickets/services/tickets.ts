import { API_BASE_URL, staffApi } from "../../../lib/axios";

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

export type SupportTicketCreatePayload = {
  affectedArea?: string | null;
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
    const baseUrl = staffApi.defaults.baseURL ?? API_BASE_URL;
    return attachment.url.startsWith("http") ? attachment.url : new URL(attachment.url, baseUrl).toString();
  }
  return "";
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
