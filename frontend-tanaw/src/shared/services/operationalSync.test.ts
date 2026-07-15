import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../lib/apiClient";
import { getLocationEvidenceWarning, listOperationalMapEnterprises } from "./operationalSync";

vi.mock("../lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const getMock = vi.mocked(apiClient.get);

describe("site registry adapter", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("paginates by stable site ID and never fabricates missing live values", async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          items: [siteResource({ liveState: null, topologyStatus: "unlinked" })],
          nextCursor: "20000000-0000-4000-8000-000000000002",
          evaluatedAt: "2026-07-13T08:00:00Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            siteResource({
              siteId: "20000000-0000-4000-8000-000000000002",
              liveState: liveState({ freshnessState: "stale", currentOccupancy: null, venueLocalUniqueEstimateWindow: null }),
            }),
          ],
          nextCursor: null,
          evaluatedAt: "2026-07-13T08:00:30Z",
        },
      });

    const sites = await listOperationalMapEnterprises();

    expect(getMock).toHaveBeenNthCalledWith(1, "/operational/sites/v2", { params: { limit: 200 } });
    expect(getMock).toHaveBeenNthCalledWith(2, "/operational/sites/v2", {
      params: { limit: 200, afterSiteId: "20000000-0000-4000-8000-000000000002" },
    });
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({
      id: "20000000-0000-4000-8000-000000000001",
      enterpriseId: "10000000-0000-4000-8000-000000000001",
      status: "No Data",
      gatewayStatus: "Not Linked",
      totalLiveOccupancy: null,
      estimatedUniqueCount: null,
    });
    expect(sites[1]).toMatchObject({
      status: "Warning",
      gatewayStatus: "Sync Delayed",
      freshnessState: "stale",
      totalLiveOccupancy: null,
      estimatedUniqueCount: null,
    });
  });

  it("rejects a repeated server cursor instead of looping or truncating silently", async () => {
    getMock.mockResolvedValue({
      data: {
        items: [],
        nextCursor: "20000000-0000-4000-8000-000000000002",
        evaluatedAt: "2026-07-13T08:00:00Z",
      },
    });

    await expect(listOperationalMapEnterprises()).rejects.toThrow("repeated pagination cursor");
  });

  it("flags materially different registered and geocoded addresses", () => {
    expect(
      getLocationEvidenceWarning({
        address: "123 Main Street, Poblacion, San Pedro",
        geocodedAddress: "National Highway, San Antonio, Biñan",
        latitude: 14.34,
        longitude: 121.04,
        locationConfidence: 0.92,
      }),
    ).toContain("differ");
  });
});

function siteResource(
  overrides: Partial<{
    siteId: string;
    topologyStatus: "ready" | "unlinked" | "ambiguous";
    liveState: ReturnType<typeof liveState> | null;
  }> = {},
) {
  return {
    siteId: overrides.siteId ?? "20000000-0000-4000-8000-000000000001",
    enterpriseId: "10000000-0000-4000-8000-000000000001",
    enterpriseName: "Enterprise One",
    enterpriseCategory: "Hotel",
    enterpriseLifecycleState: "active",
    classification: "official",
    siteName: "Main Site",
    barangay: "Poblacion",
    address: "123 Main Street",
    geocodedAddress: null,
    locationSource: "registry",
    locationConfidence: 0.95,
    coordinatesUpdatedAt: "2026-07-13T07:00:00Z",
    latitude: 14.34,
    longitude: 121.04,
    topologyStatus: overrides.topologyStatus ?? "ready",
    liveState: overrides.liveState === undefined ? liveState() : overrides.liveState,
  };
}

function liveState(
  overrides: Partial<{
    freshnessState: "fresh" | "stale" | "offline";
    currentOccupancy: number | null;
    venueLocalUniqueEstimateWindow: number | null;
  }> = {},
) {
  return {
    freshnessState: overrides.freshnessState ?? "fresh",
    currentOccupancy: overrides.currentOccupancy === undefined ? 12 : overrides.currentOccupancy,
    venueLocalUniqueEstimateWindow: overrides.venueLocalUniqueEstimateWindow === undefined ? 18 : overrides.venueLocalUniqueEstimateWindow,
    observedAt: "2026-07-13T08:00:00Z",
    receivedAt: "2026-07-13T08:00:01Z",
    serviceState: "healthy" as const,
    syncHealth: { pendingCount: 0 },
  };
}
