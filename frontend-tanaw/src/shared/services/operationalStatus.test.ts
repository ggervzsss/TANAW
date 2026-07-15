import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../lib/apiClient";
import { getOperationalStatus } from "./operationalStatus";

vi.mock("../lib/apiClient", () => ({ apiClient: { get: vi.fn() } }));

const getMock = vi.mocked(apiClient.get);

describe("getOperationalStatus", () => {
  beforeEach(() => getMock.mockReset());

  it("reads the target operational diagnostics endpoint", async () => {
    const status = {
      observedAt: "2026-07-15T08:00:00Z",
      processInstanceOnly: true,
      counters: { report_command_replays: 1 },
      finalizationScopes: { citywide: 0, barangay: 1, enterprise_selection: 0 },
      telemetryObservedToReceivedLag: { observations: 1, latestSeconds: 2, maximumSeconds: 2 },
      domainEventPublishLag: { observations: 1, latestSeconds: 1, maximumSeconds: 1 },
      domainEventQueue: {
        pending: 1,
        leased: 0,
        retryScheduled: 0,
        delivered: 4,
        deadLetter: 0,
        oldestPendingAt: "2026-07-15T07:59:30Z",
        oldestPendingAgeSeconds: 30,
        oldestReadyAt: "2026-07-15T07:59:30Z",
        oldestLeaseExpiryAt: null,
      },
      officialLiveSites: { fresh: 2, stale: 1, offline: 0, unobserved: 0 },
    };
    getMock.mockResolvedValue({ data: status });

    await expect(getOperationalStatus()).resolves.toEqual(status);
    expect(getMock).toHaveBeenCalledWith("/maintenance/operations");
  });
});
