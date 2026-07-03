import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlHealth,
  getMlServiceStatus,
  getMlSession,
  getSimulationStatus,
  listLocalReportSubmissions,
  markLocalEventsSynced,
  markLocalReportSynced,
  prepareLocalMockCounts,
  resetLocalMockData,
  type LocalReportSubmissionRecord,
  type MlHealth,
  type MlServiceStatus,
  type MlSession,
  type SimulationStatus,
} from "../../camera/services/ml-service";

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
    const pendingPeriods =
      preparation.pendingCounts?.map((counts) => counts.period) ??
      (preparation.counts ? [preparation.counts.period] : []);
    if (
      currentMetrics.mock_run_id === preparation.runId &&
      currentMetrics.period &&
      pendingPeriods.includes(currentMetrics.period) &&
      currentMetrics.unsubmitted_events > 0
    ) {
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
  if (!period) return preparation.counts;
  return (
    preparation.pendingCounts?.find((counts) => counts.period === period) ??
    (preparation.counts?.period === period ? preparation.counts : null)
  );
}

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
  await markLocalEventsSynced(baseUrl);
  return payload;
}

export async function syncDesktopReportSubmissions(limit = 100) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const submissions = (await listLocalReportSubmissions(baseUrl, limit)).filter((submission) => submission.sync_status !== "synced");
  let syncedCount = 0;

  for (const submission of submissions) {
    await syncReportSubmission(baseUrl, submission);
    syncedCount += 1;
  }

  return syncedCount;
}

async function syncReportSubmission(baseUrl: string, submission: LocalReportSubmissionRecord) {
  await staffApi.post("/operational/desktop/report-submissions", {
    reportId: submission.report_id,
    period: submission.period,
    submittedAt: submission.submitted_at,
    entries: submission.entries,
    exits: submission.exits,
    peakOccupancy: submission.peak_occupancy,
    uniqueCount: submission.unique_count,
    notes: submission.notes,
    syncStatus: submission.sync_status,
    sourceKind: sourceKindFromPayload(submission),
    mockRunId: mockRunIdFromPayload(submission),
    payload: {
      ...submission.payload,
      localLedger: {
        syncStatus: submission.sync_status,
        syncedAt: submission.synced_at,
      },
    },
  });
  await markLocalReportSynced(baseUrl, submission.report_id);
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
