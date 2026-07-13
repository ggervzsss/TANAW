import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser, FinalReport, IntakeReport, OperationalSummary, TelemetrySnapshot } from "../types";
import { createOperationalQueryKeys, handleOperationalEnvelope, operationalFinalReportsQueryKey, operationalReportsQueryKey, operationalSummaryQueryKey } from "./useOperationalSync";

vi.mock("@/app/store/authStore", () => ({ useAuthStore: vi.fn() }));
vi.mock("react-hot-toast/headless", () => ({ default: { error: vi.fn() } }));

const user = createUser("account-1", "staff");

describe("operational realtime reconciliation", () => {
  it("scopes protected operational keys by account and authorization context", () => {
    const first = createOperationalQueryKeys(user);
    const otherAccount = createOperationalQueryKeys(createUser("account-2", "staff"));
    const otherRole = createOperationalQueryKeys(createUser("account-1", "admin"));

    expect(first.reports).not.toEqual(otherAccount.reports);
    expect(first.reports).not.toEqual(otherRole.reports);
    expect(JSON.stringify(first)).not.toContain("secret-token");
  });

  it("invalidates an unfetched list instead of manufacturing a one-item result", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    client.getQueryCache().build(client, { queryKey: keys.reports, queryFn: async () => [] });

    handleOperationalEnvelope(client, keys, JSON.stringify({ type: "report.submitted", data: createReport() }));

    expect(client.getQueryData(keys.reports)).toBeUndefined();
    expect(client.getQueryState(keys.reports)?.isInvalidated).toBe(true);
  });

  it("does not let an older telemetry snapshot replace current enterprise state", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    const current = createTelemetry("snapshot-current", "2026-07-13T08:15:00Z", 20);
    const older = createTelemetry("snapshot-older", "2026-07-13T08:14:00Z", 5);
    client.setQueryData(keys.telemetry, [current]);

    handleOperationalEnvelope(client, keys, JSON.stringify({ type: "telemetry.snapshot", data: older }));

    expect(client.getQueryData<TelemetrySnapshot[]>(keys.telemetry)).toEqual([current]);
  });

  it("keeps one latest snapshot per enterprise when a newer snapshot arrives", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    const current = createTelemetry("snapshot-current", "2026-07-13T08:15:00Z", 20);
    const newer = createTelemetry("snapshot-new", "2026-07-13T08:16:00Z", 24);
    client.setQueryData(keys.telemetry, [current]);

    handleOperationalEnvelope(client, keys, JSON.stringify({ type: "telemetry.snapshot", data: newer }));

    expect(client.getQueryData<TelemetrySnapshot[]>(keys.telemetry)).toEqual([newer]);
  });

  it("invalidates intake, final, summary, and report detail caches for report events", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    const report = createReport();
    const finalReport = createFinalReport();
    const summary = createSummary();
    const intakeDetailKey = [...keys.reports, "detail", report.id];
    const finalDetailKey = [...keys.finalReports, "detail", finalReport.id];
    client.setQueryData(keys.reports, [report]);
    client.setQueryData(keys.finalReports, [finalReport]);
    client.setQueryData(keys.summary, summary);
    client.setQueryData(intakeDetailKey, report);
    client.setQueryData(finalDetailKey, finalReport);

    handleOperationalEnvelope(client, keys, JSON.stringify({ type: "report.updated", data: { ...report, status: "Ready to Consolidate" } }));

    for (const queryKey of [keys.reports, keys.finalReports, keys.summary, intakeDetailKey, finalDetailKey]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });

  it("invalidates both report collections and summary for final-report events", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    client.setQueryData(keys.reports, [createReport()]);
    client.setQueryData(keys.finalReports, [createFinalReport()]);
    client.setQueryData(keys.summary, createSummary());

    handleOperationalEnvelope(client, keys, JSON.stringify({ type: "final_report.updated", data: { ...createFinalReport(), status: "Finalized" } }));

    expect(client.getQueryState(keys.reports)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.finalReports)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.summary)?.isInvalidated).toBe(true);
  });

  it("keeps exported prefixes compatible with scoped list and detail invalidation", () => {
    const keys = createOperationalQueryKeys(user);

    expect(keys.reports.slice(0, operationalReportsQueryKey.length)).toEqual(operationalReportsQueryKey);
    expect(keys.finalReports.slice(0, operationalFinalReportsQueryKey.length)).toEqual(operationalFinalReportsQueryKey);
    expect(keys.summary.slice(0, operationalSummaryQueryKey.length)).toEqual(operationalSummaryQueryKey);
  });
});

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createUser(id: string, role: AuthUser["role"]): AuthUser {
  return {
    id,
    email: `${id}@example.test`,
    displayName: id,
    role,
    title: "Operator",
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseId: role === "enterprise" ? "enterprise-1" : null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 0,
    displayImageDataUrl: null,
  };
}

function createTelemetry(id: string, receivedAt: string, occupancy: number): TelemetrySnapshot {
  return {
    id,
    enterpriseId: "enterprise-1",
    enterpriseName: "Enterprise One",
    capturedAt: receivedAt,
    receivedAt,
    entries: occupancy,
    exits: 0,
    currentOccupancy: occupancy,
    peakOccupancy: occupancy,
    uniqueCount: occupancy,
    confirmedUniqueCount: occupancy,
    degradedUniqueCount: 0,
    totalEvents: occupancy,
    unsubmittedEvents: 0,
    unsyncedEvents: 0,
    running: true,
    status: "running",
    gatewayStatus: "Connected",
    sourceKind: "real",
  };
}

function createReport(): IntakeReport {
  return {
    id: "report-1",
    enterpriseId: "enterprise-1",
    enterprise: "Enterprise One",
    category: "Hotel",
    barangay: "Poblacion",
    month: "July 2026",
    period: "July 2026",
    submitted: "Jul 13, 2026 08:00",
    submittedAt: "2026-07-13T08:00:00Z",
    status: "Pending Review",
    code: "RPT-1",
    metrics: { entry: 10, exit: 4, unique: 8, peak: "6" },
  };
}

function createFinalReport(): FinalReport {
  return {
    id: "final-1",
    title: "July report",
    period: "July 2026",
    generatedOn: "2026-07-13T09:00:00Z",
    preparedBy: "Staff User",
    preparedRole: "LGU Staff",
    status: "Draft",
    totalEntry: 10,
    totalExit: 4,
    totalUnique: 8,
    enterpriseCount: 1,
    sources: [],
  };
}

function createSummary(): OperationalSummary {
  return {
    enterpriseCount: 1,
    onlineGateways: 1,
    delayedGateways: 0,
    offlineGateways: 0,
    totalCurrentOccupancy: 6,
    totalEntries: 10,
    totalExits: 4,
    totalUniqueCount: 8,
    activeReports: 1,
    pendingReports: 1,
    lastSyncAt: "2026-07-13T09:00:00Z",
  };
}
