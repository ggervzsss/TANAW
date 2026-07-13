import { staffApi } from "../../../lib/axios";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlServiceStatus,
  getSimulationStatus,
  acknowledgeSyncOutboxItem,
  listLocalReportSubmissions,
  listReadySyncOutboxItems,
  prepareLocalMockCounts,
  purgeLocalReportRawEvents,
  recordSyncOutboxFailure,
  resetLocalMockData,
  type LocalSyncOutboxItem,
} from "../../camera/services/ml-service";
import { listEnterpriseFinalReports, type EnterpriseFinalReport } from "../../reports/services/report-history";
import { canonicalReportingPeriodFromSource } from "../../reports/services/reporting-period";
import type { CanonicalReportingPeriod } from "../../../types/enterprise";

export const DESKTOP_REPORT_SYNC_EVENT = "tanaw:desktop-report-submitted";

export type BackendMockPreparationCounts = {
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  period: string;
  periodKey: string;
  sourceWindow: {
    start: string;
    end: string;
  };
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

export async function prepareDesktopMockCounts(periodId?: string) {
  const serviceStatus = await getMlServiceStatus();
  const baseUrl = serviceStatus.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const simulation = await resolveOptional(() => getSimulationStatus(baseUrl));
  if (simulation?.mock_run_id && simulation.scenario) return null;

  const preparation = await getDesktopMockPreparation();
  if (!preparation) return null;

  if (preparation.status === "removed") {
    return resetLocalMockData(baseUrl, preparation.runId);
  }
  let selectedPeriodId = periodId;
  if (!selectedPeriodId) {
    const currentMetrics = await getLocalMetricsSummary(baseUrl);
    const pendingPeriodIds = preparationCounts(preparation).map((counts) => reportingPeriodForPreparationCounts(counts).periodId);
    if (currentMetrics.mock_run_id === preparation.runId && currentMetrics.period_id && pendingPeriodIds.includes(currentMetrics.period_id) && currentMetrics.unsubmitted_events > 0) {
      return null;
    }
    selectedPeriodId = currentMetrics.period_id ?? undefined;
  }
  if (!selectedPeriodId) return null;
  const counts = selectMockPreparationCounts(preparation, selectedPeriodId);
  if (!counts) return null;
  const reportingPeriod = reportingPeriodForPreparationCounts(counts);

  return prepareLocalMockCounts(baseUrl, {
    mockRunId: preparation.runId,
    enterpriseId: preparation.enterpriseId,
    enterpriseName: preparation.enterpriseName,
    entries: counts.entries,
    exits: counts.exits,
    uniqueCount: counts.uniqueCount,
    peakOccupancy: counts.peakOccupancy,
    periodId: reportingPeriod.periodId,
    startsAtUtc: reportingPeriod.startsAtUtc,
    endsAtUtc: reportingPeriod.endsAtUtc,
  });
}

export function reportingPeriodForPreparationCounts(counts: BackendMockPreparationCounts): CanonicalReportingPeriod {
  return canonicalReportingPeriodFromSource({
    period_id: counts.periodKey,
    period: counts.period,
    starts_at_utc: counts.sourceWindow?.start,
    ends_at_utc: counts.sourceWindow?.end,
  });
}

function preparationCounts(preparation: BackendMockPreparation) {
  return preparation.pendingCounts?.length ? preparation.pendingCounts : preparation.counts ? [preparation.counts] : [];
}

function selectMockPreparationCounts(preparation: BackendMockPreparation, periodId: string) {
  return preparationCounts(preparation).find((counts) => reportingPeriodForPreparationCounts(counts).periodId === periodId) ?? null;
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

async function resolveOptional<T>(loader: () => Promise<T>) {
  try {
    return await loader();
  } catch {
    return null;
  }
}
