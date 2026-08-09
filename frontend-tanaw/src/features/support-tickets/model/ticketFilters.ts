import { sortRecommendedSupportTickets, type SupportTicket, type SupportTicketCategory, type SupportTicketPriority } from "@/shared/services/supportTickets";

export type TicketStatusFilter = "All Statuses" | "Open" | "Working on It" | "Resolved";
export type TicketPriorityFilter = "All Priorities" | SupportTicketPriority;
export type TicketCategoryFilter = "All Categories" | SupportTicketCategory;

export type TicketFilterState = {
  category: TicketCategoryFilter;
  priority: TicketPriorityFilter;
  query: string;
  status: TicketStatusFilter;
};

export const ticketStatusFilters: TicketStatusFilter[] = ["All Statuses", "Open", "Working on It", "Resolved"];
export const ticketPriorityFilters: TicketPriorityFilter[] = ["All Priorities", "Urgent", "High", "Normal", "Low"];
export const ticketCategoryFilters: TicketCategoryFilter[] = ["All Categories", "Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"];

export const initialTicketFilters: TicketFilterState = {
  category: "All Categories",
  priority: "All Priorities",
  query: "",
  status: "All Statuses",
};

export function filterSupportTickets(tickets: readonly SupportTicket[], filters: TicketFilterState) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return sortRecommendedSupportTickets(
    tickets.filter((ticket) => {
      const searchable = [
        ticket.code,
        ticket.enterpriseName,
        ticket.enterpriseId,
        ticket.subject,
        ticket.description,
        ticket.category,
        ticket.priority,
        ticket.status,
        ticket.affectedArea ?? "",
        ticket.cameraNode ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (filters.status === "All Statuses" || ticketStatusLabel(ticket.status) === filters.status) &&
        (filters.priority === "All Priorities" || ticket.priority === filters.priority) &&
        (filters.category === "All Categories" || ticket.category === filters.category)
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
    ticketPriorityFilters.includes(filters.priority as TicketPriorityFilter) &&
    ticketCategoryFilters.includes(filters.category as TicketCategoryFilter)
  );
}

export function ticketStatusLabel(status: SupportTicket["status"]) {
  return status === "In Review" ? "Working on It" : status;
}
