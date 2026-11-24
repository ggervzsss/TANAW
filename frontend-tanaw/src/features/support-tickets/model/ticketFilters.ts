import { REQUEST_GROUPS, sortRequests, type Request, type RequestGroup } from "@/shared/services/requests";

export type TicketStatusFilter = "All Statuses" | "Sent" | "In progress" | "Resolved" | "Approved" | "Declined";
export type TicketUrgencyFilter = "All Requests" | "Urgent Only";
export type TicketGroupFilter = "All Groups" | RequestGroup;

export type TicketFilterState = {
  group: TicketGroupFilter;
  urgency: TicketUrgencyFilter;
  query: string;
  status: TicketStatusFilter;
};

export const ticketStatusFilters: TicketStatusFilter[] = ["All Statuses", "Sent", "In progress", "Resolved", "Approved", "Declined"];
export const ticketUrgencyFilters: TicketUrgencyFilter[] = ["All Requests", "Urgent Only"];
export const ticketGroupFilters: TicketGroupFilter[] = ["All Groups", ...REQUEST_GROUPS];

export const initialTicketFilters: TicketFilterState = { group: "All Groups", urgency: "All Requests", query: "", status: "All Statuses" };

export function filterSupportTickets(requests: readonly Request[], filters: TicketFilterState) {
  const query = filters.query.trim().toLowerCase();
  return sortRequests(
    requests.filter((request) => {
      const searchable = [request.code, request.enterpriseName ?? "", request.enterpriseId ?? "", request.requesterName, request.requesterEmail ?? "", request.title, request.description, request.group, request.status, request.affectedArea ?? "", request.camera ?? ""]
        .join(" ")
        .toLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        (filters.status === "All Statuses" || ticketStatusLabel(request.status) === filters.status) &&
        (filters.urgency === "All Requests" || request.urgent) &&
        (filters.group === "All Groups" || request.group === filters.group)
      );
    }),
  );
}

export function isTicketFilterState(value: unknown): value is TicketFilterState {
  if (!value || typeof value !== "object") return false;
  const filters = value as Partial<TicketFilterState>;
  return (
    typeof filters.query === "string" &&
    filters.query.length <= 200 &&
    ticketStatusFilters.includes(filters.status as TicketStatusFilter) &&
    ticketUrgencyFilters.includes(filters.urgency as TicketUrgencyFilter) &&
    ticketGroupFilters.includes(filters.group as TicketGroupFilter)
  );
}

export function ticketStatusLabel(status: Request["status"]) {
  return status === "In Progress" ? "In progress" : status;
}
