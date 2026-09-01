import { realtimeEventTypes, type components } from "@/contracts/generated/realtime";

export { realtimeEventTypes };
export type RealtimeEventType = components["schemas"]["RealtimeEventType"];
export type RealtimeConnectionState = "closed" | "connecting" | "connected" | "reconnecting" | "offline" | "resynchronizing" | "unauthorized";

type GeneratedRealtimeEnvelope = components["schemas"]["RealtimeEnvelope"];
export type RealtimeEnvelope = Omit<GeneratedRealtimeEnvelope, "actor" | "payload" | "schema_version" | "scope"> & {
  actor?: Partial<components["schemas"]["RealtimeActor"]> | null;
  payload: Record<string, unknown>;
  schema_version: 1;
  scope: Partial<components["schemas"]["RealtimeScope"]>;
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
