import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../../../ui-kit";
import type { SupportTicket } from "../services/tickets";

const statusTones: Record<SupportTicket["status"], BadgeTone> = { "In Progress": "warning", Resolved: "success", Approved: "success" };
const statusLabels: Record<SupportTicket["status"], string> = { "In Progress": "In progress", Resolved: "Resolved", Approved: "Approved" };

export function TicketStatusBadge({ status }: { status: SupportTicket["status"] }) {
  return <Badge tone={statusTones[status] ?? "info"}>{statusLabels[status] ?? status}</Badge>;
}

const tagTones: Record<"info" | "neutral" | "warning", BadgeTone> = { info: "teal", neutral: "neutral", warning: "warning" };

/** A request tag (group, area, camera, photos). Tags keep the text as written. */
export function TicketBadge({ children, tone }: { children: ReactNode; tone: "info" | "neutral" | "warning" }) {
  return (
    <Badge tone={tagTones[tone]} sentenceCase={false}>
      {children}
    </Badge>
  );
}
