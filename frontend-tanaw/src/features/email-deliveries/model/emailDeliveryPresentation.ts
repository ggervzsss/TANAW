import type { EmailDelivery } from "../services";

export const emailDeliveriesQueryKey = ["email-deliveries"] as const;

export const emailDeliveryStatusLabels: Record<EmailDelivery["status"], string> = {
  accepted: "Accepted by Resend",
  cancelled: "Cancelled",
  expired: "Expired",
  processing: "Processing",
  queued: "Queued by TANAW",
  reconciliation_required: "Provider check required",
  recorded: "Recorded locally",
  retry_scheduled: "Retry scheduled",
  terminal_failed: "Delivery failed",
};

export function filterEmailDeliveries(deliveries: EmailDelivery[], query: string, problemsOnly: boolean) {
  const visible = problemsOnly ? deliveries.filter((delivery) => delivery.status === "terminal_failed" || delivery.status === "reconciliation_required" || delivery.canRetry) : deliveries;
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return visible;
  return visible.filter((delivery) => `${delivery.recipient} ${delivery.purpose} ${emailDeliveryStatusLabels[delivery.status]}`.toLowerCase().includes(normalizedQuery));
}
