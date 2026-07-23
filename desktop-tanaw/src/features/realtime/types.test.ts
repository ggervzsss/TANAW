import { describe, expect, it } from "vitest";
import { isRealtimeEnvelope, realtimeOrderingKey, type RealtimeEnvelope } from "./types";

const event: RealtimeEnvelope = {
  schema_version: 1,
  event_id: "evt-desktop-1",
  event_type: "notification.created",
  occurred_at: "2026-07-23T12:00:00Z",
  sequence: 7,
  scope: { recipient_account_id: "enterprise-account-1" },
  actor: null,
  payload: { notification_id: "notification-1" },
};

describe("desktop realtime event contract", () => {
  it("accepts known versioned events and rejects malformed events", () => {
    expect(isRealtimeEnvelope(event)).toBe(true);
    expect(isRealtimeEnvelope({ ...event, event_type: "unknown.created" })).toBe(false);
    expect(isRealtimeEnvelope({ ...event, sequence: -1 })).toBe(false);
  });

  it("uses the recipient as the ordering entity", () => {
    expect(realtimeOrderingKey(event)).toBe("notification:enterprise-account-1");
  });
});
