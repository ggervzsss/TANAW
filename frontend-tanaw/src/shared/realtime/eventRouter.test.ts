import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { routeRealtimeEvent } from "./eventRouter";
import type { RealtimeEnvelope } from "./types";

function event(eventType: RealtimeEnvelope["event_type"]): RealtimeEnvelope {
  return {
    schema_version: 1,
    event_id: `evt-${eventType}`,
    event_type: eventType,
    occurred_at: "2026-07-23T12:00:00Z",
    sequence: 1,
    scope: {},
    payload: {},
  };
}

describe("realtime query routing", () => {
  it("invalidates only the ticket query family for a ticket message", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("support_ticket.message.created"));

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["operational", "support-tickets"],
      refetchType: "active",
    });
  });

  it("updates alert data and dependent dashboard counters", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("alert.status.changed"));

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["operational-alerts"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["operational", "summary"],
      refetchType: "active",
    });
  });
});
