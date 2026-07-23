export const realtimeEventTypes = [
  "support_ticket.created",
  "support_ticket.updated",
  "support_ticket.message.created",
  "support_ticket.status.changed",
  "notification.created",
  "notification.updated",
  "alert.created",
  "alert.updated",
  "alert.status.changed",
  "alert.resolved",
  "alert.reopened",
  "account_request.created",
  "account_request.updated",
  "account_request.approved",
  "account_request.declined",
  "enterprise.created",
  "enterprise.updated",
  "user.created",
  "user.updated",
  "user.status.changed",
  "activity.created",
  "report.created",
  "report.updated",
  "report.processing",
  "report.finalized",
  "report.archived",
  "report.failed",
  "email_delivery.updated",
  "dev_log.created",
  "telemetry.updated",
  "system_setting.updated",
] as const;

export type RealtimeEventType = (typeof realtimeEventTypes)[number];
export type RealtimeConnectionState =
  | "closed"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "resynchronizing"
  | "unauthorized";

export type RealtimeEnvelope = {
  schema_version: 1;
  event_id: string;
  event_type: RealtimeEventType;
  occurred_at: string;
  sequence: number;
  scope: {
    enterprise_id?: string | null;
    enterprise_account_id?: string | null;
    recipient_account_id?: string | null;
    ticket_id?: string | null;
    report_id?: string | null;
  };
  actor?: { user_id?: string | null; role?: string | null } | null;
  payload: Record<string, unknown>;
};

const realtimeEventTypeSet = new Set<string>(realtimeEventTypes);

export function isRealtimeEnvelope(value: unknown): value is RealtimeEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RealtimeEnvelope>;
  return (
    candidate.schema_version === 1 &&
    typeof candidate.event_id === "string" &&
    typeof candidate.event_type === "string" &&
    realtimeEventTypeSet.has(candidate.event_type) &&
    typeof candidate.occurred_at === "string" &&
    typeof candidate.sequence === "number" &&
    candidate.sequence >= 1 &&
    Boolean(candidate.scope && typeof candidate.scope === "object") &&
    Boolean(candidate.payload && typeof candidate.payload === "object")
  );
}

export function realtimeOrderingKey(event: RealtimeEnvelope) {
  const domain = event.event_type.split(".", 1)[0];
  const entityId =
    event.scope.ticket_id ??
    event.scope.report_id ??
    event.scope.recipient_account_id ??
    event.scope.enterprise_account_id ??
    event.scope.enterprise_id ??
    String(event.payload.message_id ?? event.payload.notification_id ?? event.payload.alert_id ?? event.payload.activity_id ?? "global");
  return `${domain}:${entityId}`;
}
