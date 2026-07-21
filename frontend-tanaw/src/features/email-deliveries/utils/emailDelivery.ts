import type { EmailDelivery } from "@/shared/services/accountManagement";

export function isEmailProblem(delivery: EmailDelivery) {
  return delivery.status === "terminal_failed" || delivery.status === "reconciliation_required" || delivery.canRetry;
}
