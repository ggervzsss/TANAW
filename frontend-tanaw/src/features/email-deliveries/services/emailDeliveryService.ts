import { apiClient } from "@/shared/lib/apiClient";

export const emailDeliveriesQueryKey = ["email-deliveries"] as const;

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
  /** The account the email went to, with its name and role, when TANAW knows it. */
  accountId?: string | null;
  recipientName?: string | null;
  recipientRole?: string | null;
};

/** Emails TANAW sent in the last `sinceDays` days, newest first. */
export async function listRecentEmailDeliveries(sinceDays: number) {
  const response = await apiClient.get<EmailDelivery[]>("/mail/deliveries", { params: { sinceDays } });
  return response.data;
}

export async function retryEmailDelivery(deliveryId: string) {
  const response = await apiClient.post<EmailDelivery>(`/mail/deliveries/${deliveryId}/retry`);
  return response.data;
}
