import { apiClient } from "@/shared/lib/apiClient";

export type EmailDelivery = {
  id: string;
  purpose: string;
  recipient: string;
  provider: string;
  status: "queued" | "processing" | "retry_scheduled" | "accepted" | "recorded" | "terminal_failed" | "cancelled" | "expired" | "reconciliation_required";
  attemptCount: number;
  maxAttempts: number;
  manualRetryCount: number;
  nextAttemptAt: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  failureReason: string | null;
  outcomeUncertain: boolean;
  canRetry: boolean;
  createdAt: string;
  acceptedAt: string | null;
};

export async function listEmailDeliveries() {
  const response = await apiClient.get<EmailDelivery[]>("/mail/deliveries");
  return response.data;
}

export async function retryEmailDelivery(deliveryId: string) {
  const response = await apiClient.post<EmailDelivery>(`/mail/deliveries/${deliveryId}/retry`);
  return response.data;
}
