import type { RecordStatusTone } from "@/shared/ui-kit/lib/recordStatus";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { PriorityAlert, SystemLog } from "@/shared/types";

/* The two lists at the bottom of the dashboard: the latest activity and the latest requests. */

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The newest `limit` activity records. */
export function latestActivity(logs: readonly SystemLog[], limit = 3) {
  return [...logs].sort((left, right) => timestamp(right.timestamp) - timestamp(left.timestamp) || left.id.localeCompare(right.id)).slice(0, limit);
}

/** The short plain-text tag at the end of an activity row. */
export function activityTag(log: Pick<SystemLog, "action" | "category" | "resolutionStatus">) {
  const action = log.action.toLowerCase();
  if (log.resolutionStatus === "Resolved") return "Resolved";
  if (log.resolutionStatus === "Unresolved") return "Request";
  if (/sign(ed)?[ -]?in|log(ged)?[ -]?in/.test(action)) return "Login";
  if (/sign(ed)?[ -]?out|log(ged)?[ -]?out/.test(action)) return "Logout";
  if (log.category === "Staff Submission" || action.includes("report")) return "Report";
  if (action.includes("ticket") || action.includes("support") || action.startsWith("alert ")) return "Request";
  if (/password|account|register|activate|deactivate/.test(action)) return "Account";
  if (/update|edit|change|save/.test(action)) return "Update";
  return "Activity";
}

export type RequestProgress = "Seen by IT" | "In progress" | "Resolved";

export const requestProgressTone: Record<RequestProgress, RecordStatusTone> = {
  "Seen by IT": "pending",
  "In progress": "reviewing",
  Resolved: "consolidated",
};

/** Alert "New" and ticket "Open" read Seen by IT, "In Review" reads In progress. */
export function requestProgress(status: PriorityAlert["status"] | SupportTicket["status"]): RequestProgress {
  if (status === "Resolved") return "Resolved";
  if (status === "In Review") return "In progress";
  return "Seen by IT";
}

const alertTitles: Record<PriorityAlert["type"], string> = {
  "Maintenance Request": "Maintenance request",
  "Password Reset Request": "Password reset request",
  "Submission Delay": "Late monthly report",
  "Foot Traffic Alert": "More visitors than usual",
  "Occupancy Spike": "Sudden rise in visitors",
  "Failed Login Threshold": "Repeated failed sign-ins",
};

export type RecentRequest = {
  key: string;
  title: string;
  place: string;
  time: string;
  progress: RequestProgress;
  /** Query string that opens this request on the Requests page. */
  search: string;
};

/** The newest `limit` alerts and support tickets together, newest activity first. */
export function latestRequests(alerts: readonly PriorityAlert[], tickets: readonly SupportTicket[], limit = 3): RecentRequest[] {
  const items: RecentRequest[] = [
    ...alerts.map((alert) => ({
      key: `alert-${alert.id}`,
      title: alertTitles[alert.type] ?? alert.type,
      place: alert.enterprise || alert.requester,
      time: alert.time,
      progress: requestProgress(alert.status),
      search: `?${new URLSearchParams({ alert: alert.id })}`,
    })),
    ...tickets.map((ticket) => ({
      key: `ticket-${ticket.id}`,
      title: ticket.subject,
      place: ticket.enterpriseName,
      time: ticket.updatedAt || ticket.createdAt,
      progress: requestProgress(ticket.status),
      search: `?${new URLSearchParams({ ticket: ticket.id })}`,
    })),
  ];
  return items.sort((left, right) => timestamp(right.time) - timestamp(left.time) || left.key.localeCompare(right.key)).slice(0, limit);
}
