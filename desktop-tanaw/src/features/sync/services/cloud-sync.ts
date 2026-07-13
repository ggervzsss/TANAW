import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlHealth,
  getMlServiceStatus,
  getMlSession,
  getSimulationStatus,
  acknowledgeSyncOutboxItem,
  listLocalReportSubmissions,
  listReadySyncOutboxItems,
  prepareLocalMockCounts,
  purgeLocalReportRawEvents,
  recordSyncOutboxFailure,
  resetLocalMockData,
  type LocalSyncOutboxItem,
  type MlHealth,
  type MlServiceStatus,
  type MlSession,
  type SimulationStatus,
} from "../../camera/services/ml-service";
import { listEnterpriseFinalReports, type EnterpriseFinalReport } from "../../reports/services/report-history";

export const DESKTOP_REPORT_SYNC_EVENT = "tanaw:desktop-report-submitted";

const DEVICE_ID_STORAGE_KEY = "tanaw-desktop-device-id";

type DesktopTelemetryPayload = {
  deviceId: string;
  capturedAt: string;
  metrics: {
    entries: number;
    exits: number;
    peakOccupancy: number;
    currentOccupancy: number;
    uniqueCount: number;
    confirmedUniqueCount: number;
    degradedUniqueCount: number;
    totalEvents: number;
    unsubmittedEvents: number;
    unsyncedEvents: number;
    firstEventAt: string | null;
    lastEventAt: string | null;
  };
  session: {
    running: boolean;
    status: string;
    error: string | null;
    cameraId: number | null;
    cameraName: string | null;
    updatedAt: string | null;
  };
  health: {
    analyticsFps: number | null;
    processingProfile: string | null;
    detectorP50Ms: number | null;
    detectorP95Ms: number | null;
    processingFrameAgeMs: number | null;
    processingFramesSkipped: number;
    modelReady: boolean;
    reidReady: boolean;
    qualityReidReady: boolean;
    reidQueueDepth: number;
    qualityReidQueueDepth: number;
  };
  sourceKind: "real" | "mock" | "hybrid";
  mockRunId: string | null;
  payload: Record<string, unknown>;
};

export type BackendMockPreparationCounts = {
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  period: string;
};

export type BackendMockPreparation = {
  runId: string;
  status: "active" | "removed";
  enterpriseId: string;
  enterpriseName: string;
  counts: BackendMockPreparationCounts | null;
  pendingCounts?: BackendMockPreparationCounts[];
};

export async function getDesktopMockPreparation() {
  const response = await staffApi.get<BackendMockPreparation | null>("/operational/desktop/mock-preparation");
  return response.data;
}

export async function prepareDesktopMockCounts(period?: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const simulation = await resolveOptional(() => getSimulationStatus(baseUrl));
  if (simulation?.mock_run_id && simulation.scenario) return null;

  const preparation = await getDesktopMockPreparation();
  if (!preparation) return null;

  if (preparation.status === "removed") {
    return resetLocalMockData(baseUrl, preparation.runId);
  }
  if (!period) {
    const currentMetrics = await getLocalMetricsSummary(baseUrl);
    const pendingPeriods = preparation.pendingCounts?.map((counts) => counts.period) ?? (preparation.counts ? [preparation.counts.period] : []);
    if (currentMetrics.mock_run_id === preparation.runId && currentMetrics.period && pendingPeriods.includes(currentMetrics.period) && currentMetrics.unsubmitted_events > 0) {
      return null;
    }
  }
  const counts = selectMockPreparationCounts(preparation, period);
  if (!counts) return null;

  return prepareLocalMockCounts(baseUrl, {
    mockRunId: preparation.runId,
    enterpriseId: preparation.enterpriseId,
    enterpriseName: preparation.enterpriseName,
    entries: counts.entries,
    exits: counts.exits,
    uniqueCount: counts.uniqueCount,
    peakOccupancy: counts.peakOccupancy,
    period: counts.period,
  });
}

function selectMockPreparationCounts(preparation: BackendMockPreparation, period?: string) {
  if (!period) {
    const currentPeriod = currentReportingPeriodLabel();
    return preparation.pendingCounts?.find((counts) => isSameReportingMonth(counts.period, currentPeriod)) ?? preparation.counts;
  }
  return (
    preparation.pendingCounts?.find((counts) => isSameReportingMonth(counts.period, period)) ??
    (preparation.counts && isSameReportingMonth(preparation.counts.period, period) ? preparation.counts : null)
  );
}

function currentReportingPeriodLabel() {
  const now = reportingDate(new Date());
  const month = monthName(now.monthIndex);
  const lastDay = lastDayOfMonth(now.year, now.monthIndex);
  return `${month} 1 - ${month} ${lastDay}, ${now.year}`;
}

function isSameReportingMonth(first: string, second: string) {
  return reportingMonthKey(first) === reportingMonthKey(second);
}

function reportingMonthKey(value: string) {
  const normalizedValue = value.trim();
  const rangeMatch = /^([A-Za-z]+)\s+\d{1,2}\s*-\s*(?:([A-Za-z]+)\s+)?\d{1,2},\s*(\d{4})$/.exec(normalizedValue);
  if (rangeMatch) {
    return monthKey(rangeMatch[2] || rangeMatch[1], rangeMatch[3]) ?? normalizedValue.toLowerCase();
  }

  const monthYearMatch = /^([A-Za-z]+)\s+(\d{4})$/.exec(normalizedValue);
  if (monthYearMatch) {
    return monthKey(monthYearMatch[1], monthYearMatch[2]) ?? normalizedValue.toLowerCase();
  }

  return normalizedValue.toLowerCase();
}

function monthKey(monthLabel: string, yearLabel: string) {
  const monthIndex = monthIndexFromLabel(monthLabel);
  const year = Number(yearLabel);
  if (monthIndex === null || !Number.isInteger(year)) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

type CalendarDate = {
  day: number;
  monthIndex: number;
  year: number;
};

function reportingDate(value: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(value);
  const partValue = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    day: partValue("day"),
    monthIndex: partValue("month") - 1,
    year: partValue("year"),
  };
}

function monthIndexFromLabel(monthLabel: string): number | null {
  const monthIndex = MONTH_INDEX_BY_LABEL[monthLabel.slice(0, 3).toLowerCase()];
  return typeof monthIndex === "number" ? monthIndex : null;
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthName(monthIndex: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, monthIndex, 1)));
}

const REPORTING_TIME_ZONE = "Asia/Manila";

const MONTH_INDEX_BY_LABEL: Partial<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export async function syncDesktopTelemetry() {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const [metrics, session, health, simulation] = await Promise.all([
    getLocalMetricsSummary(baseUrl, { includeSubmitted: true }),
    resolveOptional(() => getMlSession(baseUrl)),
    resolveOptional(() => getMlHealth(baseUrl)),
    resolveOptional(() => getSimulationStatus(baseUrl)),
  ]);
  const simulationRunId = activeSimulationRunId(simulation);

  const payload: DesktopTelemetryPayload = {
    deviceId: getDesktopDeviceId(),
    capturedAt: new Date().toISOString(),
    metrics: {
      entries: metrics.entries,
      exits: metrics.exits,
      peakOccupancy: metrics.peak_occupancy,
      currentOccupancy: metrics.current_occupancy,
      uniqueCount: metrics.unique_count,
      confirmedUniqueCount: metrics.confirmed_unique_count,
      degradedUniqueCount: metrics.degraded_unique_count,
      totalEvents: metrics.total_events,
      unsubmittedEvents: metrics.unsubmitted_events,
      unsyncedEvents: metrics.unsynced_events,
      firstEventAt: metrics.first_event_at,
      lastEventAt: metrics.last_event_at,
    },
    session: sessionSummary(session, serviceStatus),
    health: healthSummary(health),
    sourceKind: simulationRunId ? (simulation?.mode === "hybrid" ? "hybrid" : "mock") : sourceKindFromPayload(metrics),
    mockRunId: simulationRunId ?? mockRunIdFromPayload(metrics),
    payload: {
      service: serviceStatus,
      simulation: simulationPayload(simulation),
      syncedAt: new Date().toISOString(),
    },
  };

  await staffApi.post("/operational/desktop/telemetry", payload);
  return payload;
}

export async function syncDesktopReportSubmissions(limit = 100) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const readyItems = await listReadySyncOutboxItems(baseUrl, limit);
  let syncedCount = 0;

  for (const item of readyItems) {
    if (await deliverSyncOutboxItem(baseUrl, item)) syncedCount += 1;
  }

  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return syncedCount;
}

export async function syncDesktopReportSubmission(reportId: string, outboxItemId?: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const submission = outboxItemId ? null : (await listLocalReportSubmissions(baseUrl, 500)).find((item) => item.report_id === reportId);
  if (submission?.sync_status === "synced") return 1;
  const exactOutboxItemId = outboxItemId ?? submission?.outbox_item_id;
  if (!exactOutboxItemId) throw new Error("The report has no exact local outbox revision to synchronize.");
  const outboxItem = (await listReadySyncOutboxItems(baseUrl, 500)).find((item) => item.outbox_item_id === exactOutboxItemId);
  if (!outboxItem) {
    const currentSubmission = (await listLocalReportSubmissions(baseUrl, 500)).find((item) => item.report_id === reportId);
    if (currentSubmission?.sync_status === "synced") return 1;
    throw new Error("The exact report revision remains queued for cloud synchronization.");
  }

  const delivered = await deliverSyncOutboxItem(baseUrl, outboxItem);
  if (!delivered) throw new Error("The exact report revision remains queued for cloud synchronization.");
  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return 1;
}

async function deliverSyncOutboxItem(baseUrl: string, item: LocalSyncOutboxItem) {
  if (item.endpoint !== "/operational/desktop/report-submissions/v2" || item.contract_version !== 2) {
    await recordSyncOutboxFailure(baseUrl, item.outbox_item_id, {
      errorClass: "invalid_outbox_contract",
      errorMessage: "The local outbox item does not target the approved report v2 endpoint.",
      retryable: false,
    });
    return false;
  }

  let acknowledgement: unknown;
  try {
    const response = await staffApi.post<Record<string, unknown>>(item.endpoint, item.payload);
    acknowledgement = response.data;
  } catch (error) {
    const failure = classifySyncFailure(error);
    await recordSyncOutboxFailure(baseUrl, item.outbox_item_id, failure);
    return false;
  }

  if (!isExactReportAcknowledgement(acknowledgement, item)) {
    await recordSyncOutboxFailure(baseUrl, item.outbox_item_id, {
      errorClass: "acknowledgement_mismatch",
      errorMessage: "The central acknowledgement did not match the exact local outbox command.",
      retryable: false,
    });
    return false;
  }

  try {
    await acknowledgeSyncOutboxItem(baseUrl, item.outbox_item_id, acknowledgement);
    return true;
  } catch {
    await recordSyncOutboxFailure(baseUrl, item.outbox_item_id, {
      errorClass: "local_acknowledgement_error",
      errorMessage: "The central commit succeeded, but its acknowledgement was not recorded locally.",
      retryable: true,
    });
    return false;
  }
}

function isExactReportAcknowledgement(acknowledgement: unknown, item: LocalSyncOutboxItem): acknowledgement is Record<string, unknown> {
  if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)) return false;
  const typedAcknowledgement = acknowledgement as Record<string, unknown>;
  const resource = typedAcknowledgement.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return false;
  const typedResource = resource as Record<string, unknown>;
  return Boolean(
    typedAcknowledgement.contractVersion === 2 &&
    typedAcknowledgement.commandId === item.command_id &&
    typedAcknowledgement.payloadHash === item.payload_hash &&
    (typedAcknowledgement.disposition === "created" || typedAcknowledgement.disposition === "replayed") &&
    isUtcTimestamp(typedAcknowledgement.acknowledgedAt) &&
    typeof typedResource.periodKey === "string" &&
    /^month:Asia\/Manila:\d{4}-(?:0[1-9]|1[0-2])$/.test(typedResource.periodKey) &&
    isUuid(typedResource.reportingPeriodId) &&
    isUuid(typedResource.enterpriseReportId) &&
    isUuid(typedResource.reportRevisionId) &&
    Number.isInteger(typedResource.revisionNumber) &&
    Number(typedResource.revisionNumber) >= 1 &&
    typedResource.workflowState === "submitted" &&
    Number.isInteger(typedResource.logicalVersion) &&
    Number(typedResource.logicalVersion) >= 1,
  );
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUtcTimestamp(value: unknown) {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function classifySyncFailure(error: unknown) {
  const response = error && typeof error === "object" ? (error as { response?: { status?: unknown } }).response : undefined;
  const status = typeof response?.status === "number" ? response.status : null;
  const retryable = status === null || status === 408 || status === 425 || status === 429 || status >= 500;
  return {
    errorClass: status === null ? "network_error" : `http_${status}`,
    errorMessage: status === null ? "The central report service could not be reached." : `The central report service returned HTTP ${status}.`,
    retryable,
    httpStatus: status,
  };
}

async function purgeFinalizedLocalReportRawData(baseUrl: string) {
  const [localSubmissions, finalReports] = await Promise.all([listLocalReportSubmissions(baseUrl, 500), listEnterpriseFinalReports()]);
  const finalizedSourceCodes = new Set(finalReports.filter(isLockedFinalReport).flatMap((report) => report.sources.map((source) => source.code)));
  const purgeableSubmissions = localSubmissions.filter((submission) => finalizedSourceCodes.has(submission.report_id) && !submission.raw_purged_at);

  for (const submission of purgeableSubmissions) {
    await purgeLocalReportRawEvents(baseUrl, submission.report_id);
  }

  return purgeableSubmissions.length;
}

function isLockedFinalReport(report: EnterpriseFinalReport) {
  return report.status === "Finalized" || (report.status === "Archived" && report.archivedFromStatus === "Finalized");
}

function activeSimulationRunId(simulation: SimulationStatus | null) {
  if (!simulation?.mock_run_id || !simulation.scenario) return null;
  return simulation.mock_run_id;
}

function simulationPayload(simulation: SimulationStatus | null) {
  if (!simulation?.mock_run_id || !simulation.scenario) return null;
  return {
    runId: simulation.mock_run_id,
    mode: simulation.mode,
    scenario: simulation.scenario,
    state: simulation.state,
    capacity: simulation.capacity,
    thresholdPercent: simulation.threshold_percent,
    eventsPerMinute: simulation.events_per_minute,
    durationMinutes: simulation.duration_minutes,
    startedAt: simulation.started_at,
    completedAt: simulation.completed_at,
  };
}

function sourceKindFromPayload(payload: unknown): "real" | "mock" | "hybrid" {
  const candidate = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const sourceKind = candidate.source_kind ?? candidate.sourceKind;
  return sourceKind === "mock" || sourceKind === "hybrid" ? sourceKind : "real";
}

function mockRunIdFromPayload(payload: unknown) {
  const candidate = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const value = candidate.mock_run_id ?? candidate.mockRunId;
  return typeof value === "string" && value.trim() ? value : null;
}

function sessionSummary(session: MlSession | null, serviceStatus: MlServiceStatus): DesktopTelemetryPayload["session"] {
  return {
    running: session?.running ?? serviceStatus.running,
    status: session?.status ?? (serviceStatus.running ? "running" : "stopped"),
    error: session?.error ?? serviceStatus.error,
    cameraId: session?.camera_id ?? null,
    cameraName: session?.camera_name ?? null,
    updatedAt: session?.updated_at ?? null,
  };
}

function healthSummary(health: MlHealth | null): DesktopTelemetryPayload["health"] {
  return {
    analyticsFps: health?.analytics_fps ?? null,
    processingProfile: health?.processing_profile ?? null,
    detectorP50Ms: health?.detector_p50_ms ?? null,
    detectorP95Ms: health?.detector_p95_ms ?? null,
    processingFrameAgeMs: health?.processing_frame_age_ms ?? null,
    processingFramesSkipped: health?.processing_frames_skipped ?? 0,
    modelReady: health?.model_ready ?? false,
    reidReady: health?.reid_model_ready ?? false,
    qualityReidReady: health?.quality_reid_model_ready ?? false,
    reidQueueDepth: health?.reid_queue_depth ?? 0,
    qualityReidQueueDepth: health?.quality_reid_queue_depth ?? 0,
  };
}

async function resolveOptional<T>(loader: () => Promise<T>) {
  try {
    return await loader();
  } catch {
    return null;
  }
}

function getDesktopDeviceId() {
  const user = useAuthStore.getState().user;
  const scope = user?.enterpriseId || user?.id || "unbound";
  const storageKey = `${DEVICE_ID_STORAGE_KEY}:${scope.replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
  const existingId = window.localStorage.getItem(storageKey);
  if (existingId) return existingId;

  const nextId = typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(storageKey, nextId);
  return nextId;
}
