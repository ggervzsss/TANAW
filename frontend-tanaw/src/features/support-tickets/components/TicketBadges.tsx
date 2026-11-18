import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/shared/services/supportTickets";
import { Badge, type BadgeTone } from "../../../design-system";
import { ticketStatusLabel } from "../model";

const statusTones: Record<SupportTicketStatus, BadgeTone> = { Open: "info", "In Review": "warning", Resolved: "success" };
const priorityTones: Record<SupportTicketPriority, BadgeTone> = { Urgent: "danger", High: "warning", Normal: "neutral", Low: "success" };

export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  return <Badge tone={statusTones[status]}>{ticketStatusLabel(status)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  return <Badge tone={priorityTones[priority]}>{priority}</Badge>;
}

export function CategoryBadge({ category }: { category: SupportTicketCategory }) {
  return <Badge tone="teal">{category}</Badge>;
}
