import type { SupportTicket } from "@/shared/services/supportTickets";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";

export type OperationsView = "situations" | "support" | "accounts";

export const operationsViews: { id: OperationsView; label: string }[] = [
  { id: "situations", label: "Needs Attention" },
  { id: "support", label: "Escalated Support" },
  { id: "accounts", label: "Account Requests" },
];

export function filterAdminAlerts(alerts: readonly PriorityAlert[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return alerts.filter((alert) => {
    const searchable = [adminAlertLabel(alert), alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, adminAlertStatusLabel(alert.status)].join(" ").toLowerCase();
    return !normalizedQuery || searchable.includes(normalizedQuery);
  });
}

export function filterAdminSupportTickets(tickets: readonly SupportTicket[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return tickets.filter((ticket) => {
    const searchable = [ticket.code, ticket.enterpriseName, ticket.subject, ticket.description, ticket.category, ticket.priority, ticket.status].join(" ").toLowerCase();
    return !normalizedQuery || searchable.includes(normalizedQuery);
  });
}

export function adminAlertStatusLabel(status: PriorityAlertStatus) {
  if (status === "New") return "Needs Attention";
  if (status === "In Review") return "Being Reviewed";
  return "Resolved";
}

export function adminAlertLabel(alert: PriorityAlert) {
  const labels: Partial<Record<PriorityAlert["type"], string>> = {
    "Foot Traffic Alert": "Busy Establishment",
    "Occupancy Spike": "Sudden Crowd Increase",
    "Submission Delay": "Late Enterprise Report",
  };
  return labels[alert.type] ?? alert.type;
}

export function isCrowdSituation(alert: PriorityAlert) {
  return ["Foot Traffic Alert", "Occupancy Spike"].includes(alert.type);
}

export function parseOperationsView(value: string | null): OperationsView {
  if (value === "support" || value === "accounts") return value;
  return "situations";
}
