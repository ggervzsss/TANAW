import type { RequestGroup, RequestStatus } from "@/shared/services/requests";
import { Badge, type BadgeTone } from "../../../shared/ui-kit";
import { ticketStatusLabel } from "../model";

const statusTones: Record<RequestStatus, BadgeTone> = { Sent: "info", "In Progress": "warning", Resolved: "success", Approved: "success", Declined: "danger" };

export function TicketStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={statusTones[status]}>{ticketStatusLabel(status)}</Badge>;
}

export function UrgentBadge() {
  return <Badge tone="danger">Urgent</Badge>;
}

export function GroupBadge({ group }: { group: RequestGroup }) {
  return <Badge tone="teal">{group}</Badge>;
}
