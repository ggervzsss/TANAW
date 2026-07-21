import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlCameraStates,
  getMlHealth,
  getMlServiceStatus,
  getMlSession,
  listLocalReportSubmissions,
  markLocalEventsSynced,
  markLocalReportSynced,
  prepareLocalSampleCounts,
  purgeLocalReportRawEvents,
  type LocalReportSubmissionRecord,
  type MlHealth,
  type MlServiceStatus,
  type MlSession,
} from "../../camera/services/ml-service";
import { listEnterpriseFinalReports, type EnterpriseFinalReport } from "../../reports/services/report-history";
import { isSameReportingMonth } from "../../reports/utils/reporting-period";

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
  payload: Record<string, unknown>;
};

export type BackendSamplePreparationCounts = {
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  period: string;
  reportId: string;
};

export type BackendSamplePreparation = {
  enterpriseId: string;
  enterpriseName: string;
  counts: BackendSamplePreparationCounts | null;
  pendingCounts?: BackendSamplePreparationCounts[];
};

export async function getDesktopSamplePreparation() {
  const response = await staffApi.get<BackendSamplePreparation | null>("/operational/desktop/sample-preparation");
  return response.data;
}

export async function prepareDesktopSampleCounts(period?: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const preparation = await getDesktopSamplePreparation();
  if (!preparation) return null;

  if (!period) {
    const currentMetrics = await getLocalMetricsSummary(baseUrl);
    const pendingPeriods =
      preparation.pendingCounts?.map((counts) => counts.period) ??
      (preparation.counts ? [preparation.counts.period] : []);
    if (
      currentMetrics.period &&
      pendingPeriods.includes(currentMetrics.period) &&
      currentMetrics.unsubmitted_events > 0
    ) {
      return null;
    }
  }
  const counts = selectSamplePreparationCounts(preparation, period);
  if (!counts) return null;

  return prepareLocalSampleCounts(baseUrl, {
    enterpriseId: preparation.enterpriseId,
    enterpriseName: preparation.enterpriseName,
    entries: counts.entries,
    exits: counts.exits,
    uniqueCount: counts.uniqueCount,
    peakOccupancy: counts.peakOccupancy,
    period: counts.period,
    reportId: counts.reportId,
  });
}

function selectSamplePreparationCounts(preparation: BackendSamplePreparation, period?: string) {
  if (!period) {
    return preparation.counts ?? preparation.pendingCounts?.[0] ?? null;
  }
  return (
    preparation.pendingCounts?.find((counts) => isSameReportingMonth(counts.period, period)) ??
    (preparation.counts && isSameReportingMonth(preparation.counts.period, period) ? preparation.counts : null)
  );
}

export async function syncDesktopTelemetry() {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const [metrics, session, health, cameraStates] = await Promise.all([
    getLocalMetricsSummary(baseUrl, { includeSubmitted: true }),
    resolveOptional(() => getMlSession(baseUrl)),
    resolveOptional(() => getMlHealth(baseUrl)),
    resolveOptional(() => getMlCameraStates(baseUrl)),
  ]);

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
    payload: {
      service: {
        ...serviceStatus,
        activeCameraCount: cameraStates?.active_camera_count ?? 0,
        maxConcurrentCameras: cameraStates?.max_concurrent_cameras ?? 0,
        cameras: cameraStates?.cameras.map((state) => ({
          cameraId: state.camera_id,
          running: state.counts.running,
          status: state.counts.status,
          error: state.counts.error,
        })) ?? [],
      },
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

  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return syncedCount;
}

export async function syncDesktopReportSubmission(reportId: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const submission = (await listLocalReportSubmissions(baseUrl, 500)).find((item) => item.report_id === reportId && item.sync_status !== "synced");
  if (!submission) return 0;

  await syncReportSubmission(baseUrl, submission);
  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return 1;
}

async function syncReportSubmission(baseUrl: string, submission: LocalReportSubmissionRecord) {
  const metrics = reportMetricsFromSubmission(submission);
  await staffApi.post("/operational/desktop/report-submissions", {
    reportId: submission.report_id,
    period: submission.period,
    submittedAt: submission.submitted_at,
    entries: metrics.entries,
    exits: metrics.exits,
    peakOccupancy: metrics.peakOccupancy,
    uniqueCount: metrics.uniqueCount,
    notes: submission.notes,
    syncStatus: submission.sync_status,
    payload: {
      ...submission.payload,
      localLedger: {
        cameraBreakdown: submission.camera_breakdown,
        syncStatus: submission.sync_status,
        syncedAt: submission.synced_at,
      },
    },
  });
  await markLocalReportSynced(baseUrl, submission.report_id);
}

function reportMetricsFromSubmission(submission: LocalReportSubmissionRecord) {
  const payloadMetrics = submission.payload.metrics;
  if (payloadMetrics && typeof payloadMetrics === "object") {
    const metrics = payloadMetrics as Record<string, unknown>;
    const entries = nonNegativeInteger(metrics.entries);
    const exits = nonNegativeInteger(metrics.exits);
    const peakOccupancy = nonNegativeInteger(metrics.peak ?? metrics.peakOccupancy ?? metrics.peak_occupancy);
    const uniqueCount = nonNegativeInteger(metrics.unique ?? metrics.uniqueCount ?? metrics.unique_count);
    if (entries !== null && exits !== null && peakOccupancy !== null && uniqueCount !== null) {
      return {
        entries,
        exits: Math.min(exits, entries),
        peakOccupancy,
        uniqueCount,
      };
    }
  }

  return {
    entries: submission.entries,
    exits: submission.exits,
    peakOccupancy: submission.peak_occupancy,
    uniqueCount: submission.unique_count,
  };
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

async function purgeFinalizedLocalReportRawData(baseUrl: string) {
  const [localSubmissions, finalReports] = await Promise.all([listLocalReportSubmissions(baseUrl, 500), listEnterpriseFinalReports()]);
  const finalizedSourceCodes = new Set(
    finalReports.filter(isLockedFinalReport).flatMap((report) => report.sources.map((source) => source.code)),
  );
  const purgeableSubmissions = localSubmissions.filter((submission) => finalizedSourceCodes.has(submission.report_id) && !submission.raw_purged_at);

  for (const submission of purgeableSubmissions) {
    await purgeLocalReportRawEvents(baseUrl, submission.report_id);
  }

  return purgeableSubmissions.length;
}

function isLockedFinalReport(report: EnterpriseFinalReport) {
  return report.status === "Finalized" || (report.status === "Archived" && report.archivedFromStatus === "Finalized");
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
