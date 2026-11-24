import { apiPaths, type ApiRequest, type ApiRequestDetail, type ApiSchemas } from "@/contracts/api";
import { API_BASE_URL } from "../config/api.config";
import { apiClient } from "../lib/apiClient";

/**
 * Requests: help asked of IT, and account changes waiting for IT's approval. IT handles every
 * request; the Admin reads them all and can add a note for IT; an enterprise sees its own.
 */
export type RequestGroup = ApiRequest["group"];
export type RequestStatus = ApiRequest["status"];
export type RequestAttachment = ApiSchemas["RequestAttachmentMetadata"];
export type RequestMessage = ApiSchemas["RequestMessageSummary"];
export type AccountChange = ApiSchemas["AccountChangeSummary"];
export type Request = ApiRequest;
export type RequestDetail = ApiRequestDetail;

export const REQUEST_GROUPS: readonly RequestGroup[] = ["Sign-in help", "Desktop app or camera problem", "Report problem", "Account change", "Other"];

export const requestsQueryKey = ["operational", "requests"];

export function requestDetailQueryKey(requestId: string) {
  return [...requestsQueryKey, requestId];
}

export function isClosedRequest(request: Pick<Request, "status">) {
  return request.status === "Resolved" || request.status === "Approved" || request.status === "Declined";
}

export function canReplyToRequest(request: Pick<Request, "status">) {
  return !isClosedRequest(request);
}

/** Open requests first, urgent ones on top, then newest first. */
export function compareRequests(left: Request, right: Request) {
  const closed = Number(isClosedRequest(left)) - Number(isClosedRequest(right));
  if (closed !== 0) return closed;
  const urgent = Number(right.urgent) - Number(left.urgent);
  if (!isClosedRequest(left) && urgent !== 0) return urgent;
  const time = safeTimestamp(Date.parse(right.createdAt)) - safeTimestamp(Date.parse(left.createdAt));
  return time || left.code.localeCompare(right.code);
}

export function sortRequests(requests: readonly Request[]) {
  return [...requests].sort(compareRequests);
}

export async function listRequests() {
  const response = await apiClient.get<Request[]>(apiPaths.requests);
  return response.data;
}

export async function getRequest(requestId: string) {
  const response = await apiClient.get<RequestDetail>(`/operational/requests/${requestId}`);
  return response.data;
}

export async function replyToRequest(requestId: string, message: string) {
  const response = await apiClient.post<RequestDetail>(`/operational/requests/${requestId}/messages`, { message });
  return response.data;
}

export async function addNoteForIt(requestId: string, message: string) {
  const response = await apiClient.post<RequestDetail>(`/operational/requests/${requestId}/notes`, { message });
  return response.data;
}

export async function updateRequestStatus(requestId: string, status: RequestStatus) {
  const response = await apiClient.patch<RequestDetail>(`/operational/requests/${requestId}/status`, { status });
  return response.data;
}

export async function reopenRequest(requestId: string) {
  const response = await apiClient.post<RequestDetail>(`/operational/requests/${requestId}/reopen`);
  return response.data;
}

export async function moveRequest(requestId: string, group: RequestGroup) {
  const response = await apiClient.patch<RequestDetail>(`/operational/requests/${requestId}/group`, { group });
  return response.data;
}

export async function markRequestUrgent(requestId: string, urgent: boolean) {
  const response = await apiClient.patch<RequestDetail>(`/operational/requests/${requestId}/urgent`, { urgent });
  return response.data;
}

export async function markRequestsRead(requestIds: readonly string[] | "all") {
  const body = requestIds === "all" ? { all: true, requestIds: [] } : { all: false, requestIds: [...requestIds] };
  const response = await apiClient.post<{ readCount: number }>("/operational/requests/read", body);
  return response.data;
}

const safeImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isSafeRequestImage(attachment: RequestAttachment) {
  return safeImageTypes.has(attachment.mediaType);
}

export async function fetchRequestAttachmentBlob(attachment: RequestAttachment) {
  if (!isSafeRequestImage(attachment)) {
    throw new Error("This attachment type cannot be previewed.");
  }
  const requestUrl = getSafeAttachmentRequestUrl(attachment.url);
  if (requestUrl) {
    const response = await apiClient.get<Blob>(requestUrl, { responseType: "blob" });
    const contentTypeHeader = response.headers["content-type"];
    const responseType = getBlobMediaType(response.data.type || (typeof contentTypeHeader === "string" ? contentTypeHeader : undefined));
    if (!safeImageTypes.has(responseType)) {
      throw new Error("The attachment response was not a supported image.");
    }
    return response.data;
  }
  throw new Error("Attachment image data is unavailable.");
}

function getSafeAttachmentRequestUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("/operational/requests/")) return url;
  try {
    const parsedUrl = new URL(url);
    const apiUrl = new URL(API_BASE_URL);
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

function safeTimestamp(value: number) {
  return Number.isFinite(value) ? value : 0;
}
