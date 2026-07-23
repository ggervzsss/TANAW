import { describe, expect, it } from "vitest";
import { isRealtimeEnvelope, realtimeOrderingKey, type RealtimeEnvelope } from "./types";

const ticketEvent: RealtimeEnvelope = {
  schema_version: 1,
  event_id: "evt-1",
  event_type: "support_ticket.message.created",
  occurred_at: "2026-07-23T12:00:00Z",
  sequence: 42,
  scope: { enterprise_account_id: "enterprise-a", ticket_id: "ticket-1" },
  actor: { user_id: "staff-1", role: "staff" },
  payload: { message_id: "message-1" },
};

describe("realtime event contract", () => {
  it("accepts the versioned server envelope", () => {
    expect(isRealtimeEnvelope(ticketEvent)).toBe(true);
  });

  it("rejects unsupported versions, event types, and invalid sequences", () => {
    expect(isRealtimeEnvelope({ ...ticketEvent, schema_version: 2 })).toBe(false);
    expect(isRealtimeEnvelope({ ...ticketEvent, event_type: "password.exposed" })).toBe(false);
    expect(isRealtimeEnvelope({ ...ticketEvent, sequence: 0 })).toBe(false);
  });

  it("orders ticket events by ticket rather than individual messages", () => {
    expect(realtimeOrderingKey(ticketEvent)).toBe("support_ticket:ticket-1");
    expect(
      realtimeOrderingKey({
        ...ticketEvent,
        event_id: "evt-2",
        payload: { message_id: "message-2" },
      }),
    ).toBe("support_ticket:ticket-1");
  });
});
