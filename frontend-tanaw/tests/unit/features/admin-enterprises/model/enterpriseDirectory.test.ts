import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  buildEnterpriseRows,
  camerasSubline,
  distinctValues,
  filterEnterpriseRows,
  filtersFromParams,
  hasActiveFilters,
  paramsFromFilters,
  resultLine,
  sortEnterpriseRows,
  summarizeEnterprises,
} from "@/features/admin-enterprises/model/enterpriseDirectory";
import type { AccountSummary, MapEnterprise } from "@/shared/types";

const now = new Date(2026, 10, 24, 15, 30);

function mapEnterprise(id: string, name: string, overrides: Partial<MapEnterprise> = {}, cameras = { configured: 2, healthy: 2 }): MapEnterprise {
  return {
    id,
    name,
    barangay: "Poblacion",
    category: "Parks",
    fullAddress: "Address not provided",
    lat: 14.3,
    lng: 121.0,
    totalLiveOccupancy: 5,
    estimatedUniqueCount: 40,
    monitoringStatus: "Fully Monitoring",
    occupancyStatus: "Normal",
    gatewayStatus: "Connected",
    lastSync: new Date(2026, 10, 24, 15, 29).toISOString(),
    cameraMonitoring: {
      status: cameras.healthy === cameras.configured ? "running" : "partial",
      configuredCameraCount: cameras.configured,
      activeCameraCount: cameras.healthy,
      healthyCameraCount: cameras.healthy,
      startingCameraCount: 0,
      stoppedCameraCount: 0,
      errorCameraCount: cameras.configured - cameras.healthy,
    },
    ...overrides,
  };
}

function account(enterpriseId: string, overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: `account-${enterpriseId}`,
    email: `${enterpriseId}@example.test`,
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: `Account ${enterpriseId}`,
    category: "Sports Complex",
    attraction: { code: "405", typeCode: "4", type: "Sports and Recreational Facilities", category: "Sports Complex", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD412" },
    attractionDescription: null,
    managerName: null,
    barangay: "Pacita I",
    address: "Pacita Avenue, San Pedro, Laguna",
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId,
    gatewayStatus: null,
    buildingCapacity: 100,
    displayName: `Account ${enterpriseId}`,
    role: "enterprise",
    title: "Enterprise",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2025-01-15T08:00:00+08:00",
    lastLoginAt: null,
    ...overrides,
  };
}

const map = [
  mapEnterprise("ENT-PLAZA", "City Plaza"),
  mapEnterprise("ENT-SPORTS", "Pacita Sports Complex", { barangay: "Pacita I", category: "Sports Complex", gatewayStatus: "Offline", monitoringStatus: "Offline" }),
  mapEnterprise("ENT-MUSEUM", "museo ng San Pedro", { barangay: "San Antonio", category: "Museum" }, { configured: 3, healthy: 2 }),
];
const accounts = [
  account("ENT-SPORTS"),
  account("ENT-NOMAP", { enterpriseName: "Riverside Market", category: "Open Air Market, Traditional Market Area", attraction: { code: "502", typeCode: "5", type: "Shopping", category: "Open Air Market, Traditional Market Area", portfolioCategory: "Cultural Tourism", ntdpCode: "TD214" }, barangay: null }),
  account("ENT-INACTIVE", { status: "inactive" }),
  account("ENT-PENDING", { isActivated: false }),
];

const rows = buildEnterpriseRows(map, accounts, now);
const byId = (id: string) => rows.find((row) => row.id === id)!;

describe("joining monitoring data with accounts", () => {
  it("lists monitored enterprises plus active accounts missing from the map", () => {
    expect(rows.map((row) => row.id)).toEqual(["ENT-PLAZA", "ENT-SPORTS", "ENT-MUSEUM", "ENT-NOMAP"]);
  });

  it("takes the classification and address from the account", () => {
    expect(byId("ENT-SPORTS")).toMatchObject({
      attractionCode: "405",
      attractionCategory: "Sports Complex",
      attractionType: "Sports and Recreational Facilities",
      portfolio: "Leisure and Entertainment Tourism",
      address: "Pacita Avenue, San Pedro, Laguna",
      registeredAt: "2025-01-15T08:00:00+08:00",
    });
  });

  it("falls back to the catalog entry for the monitoring list's category when no account matches", () => {
    expect(byId("ENT-PLAZA")).toMatchObject({ attractionCode: "411", attractionCategory: "Parks", attractionType: "Sports and Recreational Facilities", address: null });
  });

  it("shows an account-only enterprise with unknown camera status", () => {
    expect(byId("ENT-NOMAP")).toMatchObject({ name: "Riverside Market", barangay: "Unassigned", attractionType: "Shopping" });
    expect(byId("ENT-NOMAP").camera.state).toBe("unknown");
  });
});

describe("figures", () => {
  it("counts cameras and enterprises that need attention", () => {
    const summary = summarizeEnterprises(rows);
    expect(summary).toEqual({ enterprises: 4, cameras: 7, running: 4, notReporting: 3, attention: 2 });
    expect(camerasSubline(summary)).toBe("4 running right now, 3 not reporting");
    expect(camerasSubline(summarizeEnterprises([]))).toBe("No cameras reported yet");
  });
});

describe("filters", () => {
  it("searches name, barangay, category and code, word by word", () => {
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, search: "pacita sports" }).map((row) => row.id)).toEqual(["ENT-SPORTS"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, search: "502" }).map((row) => row.id)).toEqual(["ENT-NOMAP"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, search: "san antonio" }).map((row) => row.id)).toEqual(["ENT-MUSEUM"]);
  });

  it("filters by barangay, attraction type, attraction category and camera status", () => {
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, barangay: "Pacita I" }).map((row) => row.id)).toEqual(["ENT-SPORTS"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, attractionType: "Sports and Recreational Facilities" }).map((row) => row.id)).toEqual(["ENT-PLAZA", "ENT-SPORTS"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, attractionCategory: "Museum" }).map((row) => row.id)).toEqual(["ENT-MUSEUM"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, camera: "offline" }).map((row) => row.id)).toEqual(["ENT-SPORTS"]);
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, camera: "ok" }).map((row) => row.id)).toEqual(["ENT-PLAZA"]);
  });

  it("keeps only enterprises with a camera issue or no connection under Needs attention", () => {
    expect(filterEnterpriseRows(rows, { ...DEFAULT_FILTERS, attention: true }).map((row) => row.id)).toEqual(["ENT-SPORTS", "ENT-MUSEUM"]);
  });

  it("words the result line", () => {
    expect(resultLine(4, 4, DEFAULT_FILTERS)).toBe("4 enterprises found");
    expect(resultLine(2, 4, { ...DEFAULT_FILTERS, attention: true })).toBe("2 of 4 enterprises need attention");
    expect(resultLine(1, 4, { ...DEFAULT_FILTERS, attention: true })).toBe("1 of 4 enterprises needs attention");
    expect(resultLine(1, 4, { ...DEFAULT_FILTERS, barangay: "Pacita I" })).toBe("1 of 4 enterprises found");
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it("sorts by name either way, ignoring case", () => {
    expect(sortEnterpriseRows(rows, "ascending").map((row) => row.name)).toEqual(["City Plaza", "museo ng San Pedro", "Pacita Sports Complex", "Riverside Market"]);
    expect(sortEnterpriseRows(rows, "descending").map((row) => row.name)[0]).toBe("Riverside Market");
  });

  it("offers distinct dropdown values with Unassigned last", () => {
    expect(distinctValues(rows, (row) => row.barangay)).toEqual(["Pacita I", "Poblacion", "San Antonio", "Unassigned"]);
  });

  it("round-trips filters through the URL", () => {
    const filters = { ...DEFAULT_FILTERS, search: "plaza", barangay: "Poblacion", attractionType: "Shopping", attractionCategory: "Parks", camera: "issue" as const, attention: true };
    const params = paramsFromFilters(filters, { sort: "descending", page: 2 });
    expect(params.toString()).toBe("q=plaza&barangay=Poblacion&type=Shopping&category=Parks&camera=issue&attention=1&sort=desc&page=2");
    expect(filtersFromParams(params)).toEqual(filters);
    expect(filtersFromParams(new URLSearchParams("camera=bogus")).camera).toBe("all");
    expect(paramsFromFilters(DEFAULT_FILTERS).toString()).toBe("");
  });
});
