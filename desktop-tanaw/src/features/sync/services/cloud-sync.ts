import { apiPaths, type ApiDesktopReportSubmission, type ApiDesktopTelemetry, type ApiSchemas } from "../../../contracts/api";
import { isAxiosError } from "axios";
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
  markLocalReportUploadRejected,
  prepareLocalSampleCounts,
  purgeLocalReportRawEvents,
  type LocalReportSubmissionRecord,
  type MlHealth,
  type MlServiceStatus,
  type MlSession,
} from "../../camera/services/ml-service";
import { getCurrentReportingPeriod } from "../../reports/model/reporting-calendar";
import { listEnterpriseFinalReports, type EnterpriseFinalReport } from "../../reports/services/report-history";
import { isSameReportingMonth } from "../../reports/utils/reporting-period";
import { buildCameraMonitoringSummary } from "./camera-monitoring";
import { getDesktopAppInfo } from "./desktop-app-info";

export const DESKTOP_REPORT_SYNC_EVENT = "tanaw:desktop-report-submitted";
/** Sample preparation finished; open reports re-read the origins it may have confirmed. */
export const DESKTOP_SAMPLE_PREPARED_EVENT = "tanaw:desktop-sample-prepared";

const DEVICE_ID_STORAGE_KEY = "tanaw-desktop-device-id";

type DesktopTelemetryPayload = ApiDesktopTelemetry;

export type BackendSamplePreparationCounts = ApiSchemas["SamplePreparationCounts"];
export type BackendSamplePreparation = ApiSchemas["SamplePreparationSummary"];

export async function getDesktopSamplePreparation() {
  const response = await staffApi.get<BackendSamplePreparation | null>(apiPaths.desktopSamplePreparation);
  return response.data;
}

const preparedSamplePeriods = new Set<string>();

/**
 * Records the backend sample dataset's months in the local establishment ledger.
 * The local service leaves days with camera counts alone, so repeated calls are safe.
 * Completed months are sent once per local day; the current month is sent on every
 * call so today's sample visits keep up with the clock.
 */
export async function prepareDesktopSampleCounts() {
  const preparation = await getDesktopSamplePreparation();
  const pending = preparation?.pendingCounts ?? [];
  if (!preparation || !pending.length) return 0;
  const today = philippineDayStart(new Date());
  const currentPeriod = getCurrentReportingPeriod();
  const periods = pending.filter((counts) => isSameReportingMonth(counts.period, currentPeriod) || !preparedSamplePeriods.has(`${preparation.enterpriseId}|${counts.reportId}|${today}`));
  if (!periods.length) return 0;
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  let preparedDays = 0;
  for (const counts of periods) {
    const result = await prepareLocalSampleCounts(baseUrl, {
      enterpriseId: preparation.enterpriseId,
      enterpriseName: preparation.enterpriseName,
      entries: counts.entries,
      exits: counts.exits,
      uniqueCount: counts.uniqueCount,
      period: counts.period,
      reportId: counts.reportId,
    });
    preparedSamplePeriods.add(`${preparation.enterpriseId}|${counts.reportId}|${today}`);
    preparedDays += result.days;
  }
  // Origins can be confirmed even when no day changed, so notify after every run.
  window.dispatchEvent(new Event(DESKTOP_SAMPLE_PREPARED_EVENT));
  return preparedDays;
}

export async function syncDesktopTelemetry() {
  const capturedAt = new Date();
  const enterpriseId = useAuthStore.getState().user?.enterpriseId;
  const today = philippineDayStart(capturedAt);
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const [profiles, live, summary, localMetrics, session, health, cameraStates, app] = await Promise.all([
    listLocalCameras(baseUrl),
    getEstablishmentLive(baseUrl),
    getEstablishmentSummary(baseUrl, { start: new Date(today).toISOString(), end: new Date(today + DAY_MS).toISOString() }),
    getLocalMetricsSummary(baseUrl, { includeSubmitted: true }),
    resolveOptional(() => getMlSession(baseUrl)),
    resolveOptional(() => getMlHealth(baseUrl)),
    resolveOptional(() => getMlCameraStates(baseUrl)),
    getDesktopAppInfo(),
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
    app,
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

  try {
    await staffApi.post(apiPaths.desktopTelemetry, payload);
  } catch (error) {
    throw new CloudCheckInError(error);
  }
  await markLocalEventsSynced(baseUrl);
  return payload;
}

/** The check-in itself failed to reach TANAW, as opposed to the local camera service. */
export class CloudCheckInError extends Error {
  constructor(readonly cause: unknown) {
    super("The check-in could not be sent to TANAW.");
    this.name = "CloudCheckInError";
  }
}

/** Backend answers that will not change on retry: the report itself was refused. */
const REFUSED_UPLOAD_STATUSES = new Set([400, 409, 413, 422]);

/**
 * Whether the backend refused a report upload for good. An expired sign-in (401, 403), a
 * missing route, a timeout or rate limit, and server errors are worth retrying instead.
 */
export function isRefusedUpload(error: unknown) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  return status !== undefined && REFUSED_UPLOAD_STATUSES.has(status);
}

/**
 * The backend's reason for refusing a report upload, such as a second report for a month that
 * already has one; null when the upload was not refused or the backend gave no readable reason.
 */
export function refusedUploadReason(error: unknown) {
  if (!isRefusedUpload(error) || !isAxiosError<{ detail?: unknown }>(error)) return null;
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail.trim() : null;
}

export async function syncDesktopReportSubmissions(limit = 100) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const submissions = (await listLocalReportSubmissions(baseUrl, limit)).filter((submission) => submission.sync_status !== "synced" && submission.sync_status !== "upload_rejected");
  let syncedCount = 0;

  for (const submission of submissions) {
    try {
      await syncReportSubmission(baseUrl, submission);
      syncedCount += 1;
    } catch (error) {
      // A refused report must not hold back the reports after it; any other failure retries later.
      if (!isRefusedUpload(error)) throw error;
    }
  }

  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return syncedCount;
}

export async function syncDesktopReportSubmission(reportId: string, submissionId: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const submission = (await listLocalReportSubmissions(baseUrl, 500)).find((item) => item.report_id === reportId && item.submission_id === submissionId);
  if (!submission) return false;
  if (submission.sync_status === "synced") return true;

  await syncReportSubmission(baseUrl, submission);
  await resolveOptional(() => purgeFinalizedLocalReportRawData(baseUrl));
  return true;
}

const reportUploads = new Map<string, Promise<void>>();

function syncReportSubmission(baseUrl: string, submission: LocalReportSubmissionRecord) {
  const key = submission.submission_id;
  const existing = reportUploads.get(key);
  if (existing) return existing;
  const upload = uploadReportSubmission(baseUrl, submission).finally(() => reportUploads.delete(key));
  reportUploads.set(key, upload);
  return upload;
}

async function uploadReportSubmission(baseUrl: string, submission: LocalReportSubmissionRecord) {
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
  try {
    await staffApi.post(apiPaths.desktopReportSubmissions, payload);
  } catch (error) {
    // TANAW's reason is kept with the report, so the person can see what to fix.
    if (isRefusedUpload(error)) await resolveOptional(() => markLocalReportUploadRejected(baseUrl, submission.report_id, submission.submission_id, refusedUploadReason(error)));
    throw error;
  }
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

/** This computer's ID for an establishment; pass the establishment to pin work to its own session. */
export function getDesktopDeviceId(enterpriseId?: string) {
  const user = useAuthStore.getState().user;
  const scope = enterpriseId || user?.enterpriseId || user?.id || "unbound";
  const storageKey = `${DEVICE_ID_STORAGE_KEY}:${scope.replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
  const existingId = window.localStorage.getItem(storageKey);
  if (existingId) return existingId;

  const nextId = typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(storageKey, nextId);
  return nextId;
}
