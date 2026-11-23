import type { IntakeReport, MapEnterprise } from "@/shared/types";

export function mapEnterprise(overrides: Partial<MapEnterprise> & Pick<MapEnterprise, "id" | "name" | "barangay">): MapEnterprise {
  return {
    category: "Attraction",
    fullAddress: "",
    lat: 14.35,
    lng: 121.04,
    totalLiveOccupancy: null,
    estimatedUniqueCount: null,
    monitoringStatus: "Fully Monitoring",
    occupancyStatus: "Normal",
    cameraMonitoring: null,
    ...overrides,
  };
}

export function intakeReport(overrides: Partial<IntakeReport> & Pick<IntakeReport, "enterpriseId" | "enterprise" | "period">): IntakeReport {
  return {
    id: `report-${overrides.enterpriseId}-${overrides.period}`,
    attraction: {} as IntakeReport["attraction"],
    barangay: "Landayan",
    category: "Attraction",
    code: "REP",
    month: overrides.period.split(" ")[0],
    status: "Consolidated",
    submitted: "2026-10-05T08:00:00Z",
    metrics: { entry: null, exit: null, unique: 100, peak: null },
    ...overrides,
  } as IntakeReport;
}
