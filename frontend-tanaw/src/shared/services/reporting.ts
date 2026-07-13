import { apiClient } from "../lib/apiClient";
import type {
  EnterpriseReportDetail,
  EnterpriseReportListItem,
  EnterpriseReportPage,
  FinalizationAcknowledgement,
  FinalizeReportsCommand,
  FinalReportDetail,
  FinalReportListItem,
  FinalReportPage,
  FinalReportScopeType,
  ObligationFreezeAcknowledgement,
  ObligationFreezeCommand,
  PeriodComplianceResource,
  ReportingPeriodDiscoveryResource,
  ReportingPeriodLifecycleResult,
  ReportingPeriodPage,
  ReportingPeriodStatus,
  ReminderIntentAcknowledgement,
  ReportTransitionAcknowledgement,
  ReportTransitionCommand,
  ReportWorkflowState,
} from "../types";

const PAGE_LIMIT = 100;
const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const reportWorkflowQueryKey = ["operational", "reporting", "v2"] as const;
export const reportingPeriodListQueryKey = [...reportWorkflowQueryKey, "periods"] as const;
export const enterpriseReportListQueryKey = [...reportWorkflowQueryKey, "reports"] as const;
export const enterpriseReportDetailQueryKey = [...reportWorkflowQueryKey, "report-detail"] as const;
export const reportComplianceQueryKey = [...reportWorkflowQueryKey, "compliance"] as const;
export const finalReportListQueryKey = [...reportWorkflowQueryKey, "finalizations"] as const;
export const finalReportDetailQueryKey = [...reportWorkflowQueryKey, "finalization-detail"] as const;

export type EnterpriseReportFilters = {
  reportingPeriodId?: string;
  workflowState?: ReportWorkflowState;
  enterpriseId?: string;
  siteId?: string;
};

export type FinalReportFilters = {
  reportingPeriodId?: string;
  scopeType?: FinalReportScopeType;
};

export type ReportingPeriodFilters = {
  periodStatus?: ReportingPeriodStatus;
};

export async function listReportingPeriodPage(filters: ReportingPeriodFilters = {}, cursor?: string): Promise<ReportingPeriodPage> {
  const response = await apiClient.get<ReportingPeriodPage>("/operational/reporting-periods/v2", {
    params: compactParams({ ...filters, limit: PAGE_LIMIT, cursor }),
  });
  assertCursorMetadata(response.data.page, response.data.items.length, "reporting period");
  response.data.items.forEach(assertOfficialReportingPeriod);
  return response.data;
}

export async function listAllReportingPeriods(filters: ReportingPeriodFilters = {}): Promise<ReportingPeriodDiscoveryResource[]> {
  const items = await collectCursorPages((cursor) => listReportingPeriodPage(filters, cursor), "reporting period");
  assertUniqueResources(items, (item) => item.reportingPeriodId, "reporting period");
  return items;
}

export async function readReportingPeriod(reportingPeriodId: string): Promise<ReportingPeriodDiscoveryResource> {
  const response = await apiClient.get<ReportingPeriodDiscoveryResource>(`/operational/reporting-periods/${reportingPeriodId}/v2`);
  assertOfficialReportingPeriod(response.data);
  if (response.data.reportingPeriodId !== reportingPeriodId) {
    throw new Error("The reporting-period detail did not match the requested official v2 resource.");
  }
  return response.data;
}

export async function runReportingPeriodLifecycle(): Promise<ReportingPeriodLifecycleResult> {
  const response = await apiClient.post<ReportingPeriodLifecycleResult>("/operational/reporting-periods/lifecycle/run/v2");
  if (response.data.contractVersion !== 2 || response.data.ensuredPeriodCount !== response.data.periods.length) {
    throw new Error("The reporting-period lifecycle returned a non-official or non-v2 resource.");
  }
  response.data.periods.forEach(assertOfficialReportingPeriod);
  return response.data;
}

export async function listEnterpriseReportPage(filters: EnterpriseReportFilters = {}, cursor?: string): Promise<EnterpriseReportPage> {
  const response = await apiClient.get<EnterpriseReportPage>("/operational/reports/v2", {
    params: compactParams({ ...filters, limit: PAGE_LIMIT, cursor }),
  });
  assertOfficialPage(response.data, "enterprise report");
  response.data.items.forEach(assertEnterpriseReportListItem);
  return response.data;
}

export async function listAllEnterpriseReports(filters: EnterpriseReportFilters = {}): Promise<EnterpriseReportListItem[]> {
  const items = await collectCursorPages((cursor) => listEnterpriseReportPage(filters, cursor), "enterprise report");
  assertUniqueResources(items, (item) => item.enterpriseReportId, "enterprise report");
  return items;
}

export async function readEnterpriseReport(enterpriseReportId: string): Promise<EnterpriseReportDetail> {
  const response = await apiClient.get<EnterpriseReportDetail>(`/operational/reports/${enterpriseReportId}/v2`);
  assertEnterpriseReportDetail(response.data);
  if (response.data.enterpriseReportId !== enterpriseReportId) {
    throw new Error("The enterprise report detail did not match the requested official v2 resource.");
  }
  return response.data;
}

export async function transitionEnterpriseReport(enterpriseReportId: string, command: ReportTransitionCommand): Promise<ReportTransitionAcknowledgement> {
  const response = await apiClient.post<ReportTransitionAcknowledgement>(`/operational/reports/${enterpriseReportId}/transitions/v2`, command);
  if (response.data.contractVersion !== 2 || response.data.resource.enterpriseReportId !== enterpriseReportId || response.data.commandId !== command.commandId) {
    throw new Error("The report transition acknowledgement did not match the submitted command.");
  }
  return response.data;
}

export async function readPeriodCompliance(reportingPeriodId: string): Promise<PeriodComplianceResource> {
  const response = await apiClient.get<PeriodComplianceResource>(`/operational/reporting-periods/${reportingPeriodId}/compliance/v2`);
  if (response.data.reportingPeriodId !== reportingPeriodId || response.data.frozen !== true) {
    throw new Error("The compliance response did not match the requested frozen reporting period.");
  }
  for (const obligation of response.data.obligations) {
    if (
      obligation.classification !== "official" ||
      !obligation.enterpriseOfficialCode.trim() ||
      !obligation.enterpriseName.trim() ||
      !obligation.siteCode.trim() ||
      !obligation.siteName.trim()
    ) {
      throw new Error("The compliance response contained a non-official obligation or an unfrozen identity.");
    }
  }
  return response.data;
}

export async function freezePeriodObligations(reportingPeriodId: string, command: ObligationFreezeCommand): Promise<ObligationFreezeAcknowledgement> {
  const response = await apiClient.post<ObligationFreezeAcknowledgement>(`/operational/reporting-periods/${reportingPeriodId}/obligations/freeze/v2`, command);
  if (response.data.contractVersion !== 2 || response.data.commandId !== command.commandId || response.data.resource.reportingPeriodId !== reportingPeriodId) {
    throw new Error("The obligation acknowledgement did not match the submitted command.");
  }
  return response.data;
}

export async function createReminderIntents(reportingPeriodId: string, commandId: string): Promise<ReminderIntentAcknowledgement> {
  const response = await apiClient.post<ReminderIntentAcknowledgement>(`/operational/reporting-periods/${reportingPeriodId}/reminder-intents/v2`, {
    contractVersion: 2,
    commandId,
  });
  if (response.data.contractVersion !== 2 || response.data.commandId !== commandId || response.data.reportingPeriodId !== reportingPeriodId) {
    throw new Error("The reminder acknowledgement did not match the submitted command.");
  }
  return response.data;
}

export async function listFinalReportPage(filters: FinalReportFilters = {}, cursor?: string): Promise<FinalReportPage> {
  const response = await apiClient.get<FinalReportPage>("/operational/reports/finalizations/v2", {
    params: compactParams({ ...filters, limit: PAGE_LIMIT, cursor }),
  });
  assertOfficialPage(response.data, "final report");
  response.data.items.forEach(assertFinalReportListItem);
  return response.data;
}

export async function listAllFinalReports(filters: FinalReportFilters = {}): Promise<FinalReportListItem[]> {
  const items = await collectCursorPages((cursor) => listFinalReportPage(filters, cursor), "final report");
  assertUniqueResources(items, (item) => item.reportFinalizationId, "final report");
  return items;
}

export async function readFinalReport(reportFinalizationId: string, versionId?: string): Promise<FinalReportDetail> {
  const response = await apiClient.get<FinalReportDetail>(`/operational/reports/finalizations/${reportFinalizationId}/v2`, {
    params: compactParams({ versionId }),
  });
  assertFinalReportDetail(response.data);
  if (response.data.reportFinalizationId !== reportFinalizationId || (versionId !== undefined && response.data.selectedVersionId !== versionId)) {
    throw new Error("The final report detail did not match the requested official immutable version.");
  }
  return response.data;
}

export async function finalizeReports(command: FinalizeReportsCommand): Promise<FinalizationAcknowledgement> {
  const response = await apiClient.post<FinalizationAcknowledgement>("/operational/reports/finalizations/v2", command);
  if (response.data.contractVersion !== 2 || response.data.commandId !== command.commandId || response.data.resource.reportingPeriodId !== command.payload.reportingPeriodId) {
    throw new Error("The finalization acknowledgement did not match the submitted command.");
  }
  return response.data;
}

export async function collectCursorPages<TItem>(
  readPage: (cursor?: string) => Promise<{ items: TItem[]; page: { hasMore: boolean; nextCursor: string | null } }>,
  resourceName: string,
): Promise<TItem[]> {
  const items: TItem[] = [];
  const observedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const page = await readPage(cursor);
    items.push(...page.items);
    if (!page.page.hasMore) {
      if (page.page.nextCursor !== null) throw new Error(`The ${resourceName} page returned a cursor after the final page.`);
      return items;
    }
    const nextCursor = page.page.nextCursor;
    if (!nextCursor) throw new Error(`The ${resourceName} page omitted its required continuation cursor.`);
    if (observedCursors.has(nextCursor)) throw new Error(`The ${resourceName} page returned a repeated continuation cursor.`);
    observedCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function assertOfficialPage(
  page: {
    contractVersion: number;
    classification: string;
    items: unknown[];
    page: { limit: number; returnedCount: number; hasMore: boolean; nextCursor: string | null };
  },
  resourceName: string,
) {
  if (page.contractVersion !== 2 || page.classification !== "official") {
    throw new Error(`The ${resourceName} list was not an official v2 resource.`);
  }
  assertCursorMetadata(page.page, page.items.length, resourceName);
}

function assertCursorMetadata(
  page: { limit: number; returnedCount: number; hasMore: boolean; nextCursor: string | null },
  itemCount: number,
  resourceName: string,
) {
  if (page.hasMore !== Boolean(page.nextCursor)) throw new Error(`The ${resourceName} page returned inconsistent pagination metadata.`);
  if (page.returnedCount !== itemCount || page.returnedCount > page.limit) {
    throw new Error(`The ${resourceName} page returned inconsistent item counts.`);
  }
}

function compactParams(params: Record<string, string | number | undefined>) {
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
}

function assertUniqueResources<TItem>(items: TItem[], resourceId: (item: TItem) => string, resourceName: string) {
  const observed = new Set<string>();
  for (const item of items) {
    const id = resourceId(item);
    if (observed.has(id)) throw new Error(`The ${resourceName} list repeated resource ${id} across keyset pages.`);
    observed.add(id);
  }
}

function assertOfficialReportingPeriod(period: ReportingPeriodDiscoveryResource) {
  if (period.contractVersion !== 2 || period.complianceClassification !== "official") {
    throw new Error("The reporting-period response contained a non-official or non-v2 resource.");
  }
}

function assertEnterpriseReportListItem(report: EnterpriseReportListItem) {
  if (
    report.classification !== "official" ||
    report.currentRevision.reportRevisionId !== report.currentRevisionId
  ) {
    throw new Error("The enterprise report response contained inconsistent official revision identity.");
  }
  assertMetricDecimalStrings(report.currentRevision.metrics, "enterprise report");
}

function assertEnterpriseReportDetail(report: EnterpriseReportDetail) {
  if (report.contractVersion !== 2) {
    throw new Error("The enterprise report detail was not a v2 resource.");
  }
  assertEnterpriseReportListItem(report);
  if (!report.revisions.some((revision) => revision.reportRevisionId === report.currentRevisionId && revision.isCurrent)) {
    throw new Error("The enterprise report detail omitted its exact current immutable revision.");
  }
  for (const revision of report.revisions) {
    assertMetricDecimalStrings(revision.metrics, "enterprise report revision");
    assertDemographicDecimalStrings(revision.demographics, "enterprise report revision");
  }
}

function assertFinalReportListItem(report: FinalReportListItem) {
  if (
    report.classification !== "official" ||
    report.currentVersion.finalReportVersionId !== report.currentVersionId
  ) {
    throw new Error("The final report response contained inconsistent official version identity.");
  }
}

function assertFinalReportDetail(report: FinalReportDetail) {
  if (report.contractVersion !== 2) {
    throw new Error("The final report detail was not a v2 resource.");
  }
  assertFinalReportListItem(report);
  if (
    report.selectedVersion.finalReportVersionId !== report.selectedVersionId ||
    !report.versions.some((version) => version.finalReportVersionId === report.selectedVersionId)
  ) {
    throw new Error("The final report detail omitted its exact selected immutable version.");
  }
  assertMetricDecimalStrings(report.selectedVersion.metrics, "final report version");
  assertDemographicDecimalStrings(report.selectedVersion.demographics, "final report version");
}

function assertMetricDecimalStrings(metrics: Array<{ value: unknown }>, resourceName: string) {
  for (const metric of metrics) assertDecimalString(metric.value, `${resourceName} metric value`);
}

function assertDemographicDecimalStrings(demographics: Array<{ percentage: unknown }>, resourceName: string) {
  for (const demographic of demographics) assertDecimalString(demographic.percentage, `${resourceName} demographic percentage`);
}

function assertDecimalString(value: unknown, fieldName: string) {
  if (value !== null && (typeof value !== "string" || !DECIMAL_STRING_PATTERN.test(value))) {
    throw new Error(`The ${fieldName} was not an exact decimal string.`);
  }
}
