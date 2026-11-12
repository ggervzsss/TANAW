import { apiPaths, type ApiDesktopReportSubmission, type ApiDesktopTelemetry, type ApiSchemas } from "../../../contracts/api";
import { staffApi } from "../../../lib/axios";
import { DAY_MS, philippineDayStart } from "../../../utils/date-time";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getEstablishmentLive,
  getEstablishmentSummary,
  getLocalMetricsSummary,
  getMlCameraStates,
  getMlHealth,
  getMlServiceStatus,
  getMlSession,
  listLocalCameras,
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
import { buildCameraMonitoringSummary } from "./camera-monitoring";

export const DESKTOP_REPORT_SYNC_EVENT = "tanaw:desktop-report-submitted";

const DEVICE_ID_STORAGE_KEY = "tanaw-desktop-device-id";

type DesktopTelemetryPayload = ApiDesktopTelemetry;

export type BackendSamplePreparationCounts = ApiSchemas["SamplePreparationCounts"];
export type BackendSamplePreparation = ApiSchemas["SamplePreparationSummary"];

export async function getDesktopSamplePreparation() {
  const response = await staffApi.get<BackendSamplePreparation | null>(apiPaths.desktopSamplePreparation);
  return response.data;
}

export async function prepareDesktopSampleCounts(period?: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const profiles = await listLocalCameras(baseUrl);
  if (profiles?.length && profiles.every((camera) => camera.analysisMode === "open_space")) return null;
  const preparation = await getDesktopSamplePreparation();
  if (!preparation) return null;

  if (!period) {
    const currentMetrics = await getLocalMetricsSummary(baseUrl);
    const pendingPeriods = preparation.pendingCounts?.map((counts) => counts.period) ?? (preparation.counts ? [preparation.counts.period] : []);
    if (currentMetrics.period && pendingPeriods.includes(currentMetrics.period) && currentMetrics.unsubmitted_events > 0) {
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
  const capturedAt = new Date();
  const enterpriseId = useAuthStore.getState().user?.enterpriseId;
  const today = philippineDayStart(capturedAt);
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const [profiles, live, summary, localMetrics, session, health, cameraStates] = await Promise.all([
    listLocalCameras(baseUrl),
    getEstablishmentLive(baseUrl),
    getEstablishmentSummary(baseUrl, { start: new Date(today).toISOString(), end: new Date(today + DAY_MS).toISOString() }),
    getLocalMetricsSummary(baseUrl, { includeSubmitted: true }),
    resolveOptional(() => getMlSession(baseUrl)),
    resolveOptional(() => getMlHealth(baseUrl)),
    resolveOptional(() => getMlCameraStates(baseUrl)),
  ]);
  if (enterpriseId !== useAuthStore.getState().user?.enterpriseId || (enterpriseId && (live.enterprise_id !== enterpriseId || summary.enterprise_id !== enterpriseId))) {
    throw new Error("Local counts belong to a different establishment.");
  }
  const monitoring = buildCameraMonitoringSummary(profiles, cameraStates, serviceStatus);
  const hasMovement = summary.movement_state !== "unavailable";
  const hasUniqueEstimate = summary.identification_state !== "unavailable" && (summary.reconciliation_state === "estimated" || summary.reconciliation_state === "partial");

  const payload: DesktopTelemetryPayload = {
    deviceId: getDesktopDeviceId(),
    capturedAt: capturedAt.toISOString(),
    metrics: {
      entries: hasMovement ? summary.entries : null,
      exits: hasMovement ? summary.exits : null,
      peakOccupancy: summary.peak_occupancy,
      currentOccupancy: live.occupancy,
      uniqueCount: hasUniqueEstimate ? summary.unique_count : null,
      confirmedUniqueCount: hasUniqueEstimate ? summary.confirmed_unique_count : 0,
      degradedUniqueCount: hasUniqueEstimate ? summary.unique_count - summary.confirmed_unique_count : 0,
      totalEvents: summary.qualified_observations,
      unsubmittedEvents: localMetrics.unsubmitted_events,
      unsyncedEvents: localMetrics.unsynced_events,
      firstEventAt: summary.days[0]?.first_event_at ?? null,
      lastEventAt: summary.days[0]?.last_event_at ?? null,
    },
    session: sessionSummary(session, serviceStatus),
    health: healthSummary(health),
    monitoring,
    payload: {
      service: {
        ...serviceStatus,
        activeCameraCount: monitoring.activeCameraCount,
        configuredCameraCount: monitoring.configuredCameraCount,
        maxConcurrentCameras: cameraStates?.max_concurrent_cameras ?? 0,
        cameras: monitoring.cameras,
      },
      syncedAt: new Date().toISOString(),
    },
  };

  await staffApi.post(apiPaths.desktopTelemetry, payload);
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
  const payload = {
    submissionId: submission.submission_id,
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
  } satisfies ApiDesktopReportSubmission;
  await staffApi.post(apiPaths.desktopReportSubmissions, payload);
  await markLocalReportSynced(baseUrl, submission.report_id, submission.submission_id);
}

function reportMetricsFromSubmission(submission: LocalReportSubmissionRecord) {
  if (submission.payload.counting)
    return {
      entries: submission.entries,
      exits: submission.exits,
      peakOccupancy: submission.peak_occupancy,
      uniqueCount: submission.unique_count,
    };
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
        exits,
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
