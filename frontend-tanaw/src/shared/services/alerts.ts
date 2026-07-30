import { apiClient } from "../lib/apiClient";
import type { PriorityAlert, PriorityAlertStatus, TechnicalIssueUrgency } from "../types";

const urgencyRank: Record<TechnicalIssueUrgency, number> = {
  Urgent: 0,
  Important: 1,
  Normal: 2,
};

const workflowRank: Record<PriorityAlertStatus, number> = {
  New: 0,
  "In Review": 1,
  Resolved: 2,
};

export function compareRecommendedPriorityAlerts(left: PriorityAlert, right: PriorityAlert) {
  const resolvedDifference = Number(left.status === "Resolved") - Number(right.status === "Resolved");
  if (resolvedDifference !== 0) return resolvedDifference;

  if (left.status !== "Resolved") {
    const urgencyDifference = urgencyRank[left.urgency] - urgencyRank[right.urgency];
    if (urgencyDifference !== 0) return urgencyDifference;

    const statusDifference = workflowRank[left.status] - workflowRank[right.status];
    if (statusDifference !== 0) return statusDifference;
  }

  const timestampDifference = safeTimestamp(Date.parse(right.time)) - safeTimestamp(Date.parse(left.time));
  if (timestampDifference !== 0) return timestampDifference;
  return left.id.localeCompare(right.id);
}

export function sortRecommendedPriorityAlerts(alerts: readonly PriorityAlert[]) {
  return [...alerts].sort(compareRecommendedPriorityAlerts);
}

export async function listAlerts() {
  const response = await apiClient.get<PriorityAlert[]>("/operational/alerts");
  return response.data;
}

export async function updateAlertStatus(alertId: string, status: PriorityAlertStatus) {
  const response = await apiClient.patch<PriorityAlert>(`/operational/alerts/${alertId}/status`, { status });
  return response.data;
}

function safeTimestamp(value: number) {
  return Number.isFinite(value) ? value : 0;
}
