import type { ApiSchemas } from "@/contracts/api";
import { apiClient } from "@/shared/lib/apiClient";

export type AdminRequestMessagePayload = ApiSchemas["AdminRequestMessageCreate"];
export type AdminRequestMessageResult = ApiSchemas["AdminRequestMessageResult"];

export const MAX_REQUEST_MESSAGE_LENGTH = 1000;

/** Sends IT a message about a request. It reaches IT as a notification and is kept in the Admin activity history. */
export async function sendRequestMessage(payload: AdminRequestMessagePayload) {
  const response = await apiClient.post<AdminRequestMessageResult>("/operational/requests/messages", payload);
  return response.data;
}
