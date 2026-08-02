import type { EmailDelivery } from "../services";

export function isEmailProblem(delivery: EmailDelivery) {
  return delivery.status === "terminal_failed" || delivery.status === "reconciliation_required" || delivery.canRetry;
}
