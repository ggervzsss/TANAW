import { sortRecommendedPriorityAlerts } from "@/shared/services/alerts";
import type { PriorityAlert, PriorityAlertStatus, PriorityAlertType, TechnicalIssueUrgency } from "@/shared/types";

export type UrgencyFilter = "All Urgencies" | TechnicalIssueUrgency;
export type StatusFilter = "All Statuses" | "Needs Attention" | "Working on It" | "Resolved";
export type TypeFilter = "All Types" | PriorityAlertType;
export type TechnicalIssueFilters = {
  query: string;
  status: StatusFilter;
  type: TypeFilter;
  urgency: UrgencyFilter;
};

export const urgencyFilters: UrgencyFilter[] = ["All Urgencies", "Urgent", "Important", "Normal"];
export const statusFilters: StatusFilter[] = ["All Statuses", "Needs Attention", "Working on It", "Resolved"];
export const typeFilters: TypeFilter[] = ["All Types", "Maintenance Request", "Password Reset Request", "Failed Login Threshold"];
export const initialTechnicalIssueFilters: TechnicalIssueFilters = {
  query: "",
  status: "All Statuses",
  type: "All Types",
  urgency: "All Urgencies",
};

export function getTechnicalIssueStatusLabel(status: PriorityAlertStatus) {
  if (status === "New") return "Needs Attention";
  if (status === "In Review") return "Working on It";
  return "Resolved";
}

export function filterTechnicalIssues(alerts: PriorityAlert[], filters: TechnicalIssueFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return sortRecommendedPriorityAlerts(
    alerts.filter((alert) => {
      const searchable = [alert.id, alert.type, alert.urgency, alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, alert.status, alert.resolutionMode]
        .join(" ")
        .toLowerCase();
      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (filters.urgency === "All Urgencies" || alert.urgency === filters.urgency) &&
        (filters.status === "All Statuses" || getTechnicalIssueStatusLabel(alert.status) === filters.status) &&
        (filters.type === "All Types" || alert.type === filters.type)
      );
    }),
  );
}

export function isTechnicalIssueFilters(value: unknown): value is TechnicalIssueFilters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TechnicalIssueFilters>;
  return (
    typeof candidate.query === "string" &&
    urgencyFilters.includes(candidate.urgency as UrgencyFilter) &&
    statusFilters.includes(candidate.status as StatusFilter) &&
    typeFilters.includes(candidate.type as TypeFilter)
  );
}
