import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { routeRealtimeEvent } from "../../../../src/shared/realtime/eventRouter";
import type { RealtimeEnvelope } from "../../../../src/shared/realtime/types";

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
  it("refreshes requests and Activity for a request message", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("request.message.created"));

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["operational", "requests"], refetchType: "active" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["activity-logs"], refetchType: "active" });
  });

  it("updates live alerts, map pins, dashboard counters, and activity history", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("alert.status.changed"));

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["operational", "map-enterprises"], refetchType: "active" });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["activity-logs"],
      refetchType: "active",
    });
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

describe("telemetry updates in a hidden tab", () => {
  const telemetryKeys = [
    ["operational", "telemetry"],
    ["operational", "summary"],
    ["operational", "map-enterprises"],
    ["operational", "visitor-insights"],
  ];

  function fakeDocument(visibilityState: DocumentVisibilityState) {
    const listeners = new Set<() => void>();
    return {
      visibilityState,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      show() {
        this.visibilityState = "visible";
        listeners.forEach((listener) => listener());
      },
      listenerCount: () => listeners.size,
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refetches map and telemetry queries immediately while the tab is visible", async () => {
    vi.stubGlobal("document", fakeDocument("visible"));
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("telemetry.updated"));

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    for (const queryKey of telemetryKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey, refetchType: "active" });
    }
  });

  it("defers refetches until the tab is visible and coalesces them into one per query", async () => {
    const page = fakeDocument("hidden");
    vi.stubGlobal("document", page);
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    for (let index = 0; index < 5; index += 1) {
      await routeRealtimeEvent(queryClient, { ...event("telemetry.updated"), event_id: `evt-${index}`, sequence: index + 1 });
    }

    // While hidden, queries are only marked stale; nothing is fetched.
    expect(invalidateQueries.mock.calls.every(([filters]) => filters.refetchType === "none")).toBe(true);
    expect(page.listenerCount()).toBe(1);

    invalidateQueries.mockClear();
    page.show();

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    for (const queryKey of telemetryKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey, refetchType: "active" }, { cancelRefetch: false });
    }
    expect(page.listenerCount()).toBe(0);
  });

  it("keeps other live updates immediate in a hidden tab", async () => {
    vi.stubGlobal("document", fakeDocument("hidden"));
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await routeRealtimeEvent(queryClient, event("request.message.created"));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["operational", "requests"], refetchType: "active" });
  });
});
