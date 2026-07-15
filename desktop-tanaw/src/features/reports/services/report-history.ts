import { staffApi } from "../../../lib/axios";
import { collectCursorPages } from "../../../lib/cursor-pagination";

export type ReportWorkflowState = "submitted" | "returned" | "accepted" | "consolidated";

export type EnterpriseReportMetricFact = {
  definition: string;
  definitionVersion: number;
  value: string | number | null;
  unit: string;
  provenance: "camera_derived" | "operator_entered" | "system_derived";
  quality: "confirmed" | "degraded" | "estimated" | "unknown";
};

export type EnterpriseReportRevisionSummary = {
  reportRevisionId: string;
  localRevisionId: string;
  revisionNumber: number;
  submittedAt: string;
  receivedAt: string;
  evidenceStatus: "complete" | "incomplete";
  acceptanceBlocked: boolean;
  metrics: EnterpriseReportMetricFact[];
};

export type EnterpriseReportHistoryItem = {
  enterpriseReportId: string;
  classification: "official";
  workflowState: ReportWorkflowState;
  logicalVersion: number;
  currentRevisionId: string;
  acceptedRevisionId: string | null;
  includedInOfficialTotals: boolean;
  acceptanceBlocked: boolean;
  reportingPeriod: {
    reportingPeriodId: string;
    naturalKey: string;
    label: string;
    startsAt: string;
    endsAt: string;
  };
  enterprise: {
    enterpriseId: string;
    enterpriseCode: string;
    enterpriseName: string;
    category: string | null;
  };
  site: {
    siteId: string;
    siteCode: string;
    siteName: string;
    frozenBarangay: string | null;
  };
  currentRevision: EnterpriseReportRevisionSummary;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseReportDetail = EnterpriseReportHistoryItem & {
  contractVersion: 2;
  revisions: Array<
    EnterpriseReportRevisionSummary & {
      notes: string | null;
      demographics: Array<{
        dimension: string;
        value: string;
        count: number;
        provenance: "operator_entered" | "system_derived";
        quality: "confirmed" | "degraded" | "estimated";
      }>;
    }
  >;
};

type EnterpriseReportPage = {
  contractVersion: 2;
  classification: "official";
  items: EnterpriseReportHistoryItem[];
  page: {
    limit: number;
    returnedCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export async function listEnterpriseReportHistory() {
  return collectCursorPages(async (cursor) => {
    const response = await staffApi.get<unknown>("/operational/enterprise/reports/v2", {
      params: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    const page = requireReportPage(response.data);
    return { items: page.items, page: page.page };
  }, "report history");
}

export async function readEnterpriseReport(reportId: string) {
  const response = await staffApi.get<unknown>(
    `/operational/enterprise/reports/${encodeURIComponent(reportId)}/v2`,
  );
  return requireReportDetail(response.data);
}

function requireReportPage(value: unknown): EnterpriseReportPage {
  const page = requireRecord(value, "report history response");
  if (page.contractVersion !== 2 || page.classification !== "official" || !Array.isArray(page.items)) {
    throw new Error("The report history response is not an official contract-version-2 page.");
  }
  const pageInfo = requireRecord(page.page, "report history page metadata");
  if (
    typeof pageInfo.hasMore !== "boolean" ||
    (pageInfo.nextCursor !== null && typeof pageInfo.nextCursor !== "string") ||
    !Number.isInteger(pageInfo.returnedCount) ||
    pageInfo.returnedCount !== page.items.length
  ) {
    throw new Error("The report history page metadata is inconsistent.");
  }
  return {
    contractVersion: 2,
    classification: "official",
    items: page.items.map(requireHistoryItem),
    page: pageInfo as EnterpriseReportPage["page"],
  };
}

function requireReportDetail(value: unknown): EnterpriseReportDetail {
  const detail = requireRecord(value, "report detail response");
  if (detail.contractVersion !== 2 || !Array.isArray(detail.revisions)) {
    throw new Error("The report detail response is not contract version 2.");
  }
  const summary = requireHistoryItem(detail);
  const revisions = detail.revisions.map((value) => {
    requireRevision(value);
    const source = requireRecord(value, "report revision");
    if (!Array.isArray(source.demographics) || (source.notes !== null && typeof source.notes !== "string")) {
      throw new Error("The report revision detail is incomplete.");
    }
    return source as EnterpriseReportDetail["revisions"][number];
  });
  return { ...summary, contractVersion: 2, revisions };
}

function requireHistoryItem(value: unknown): EnterpriseReportHistoryItem {
  const item = requireRecord(value, "report history item");
  const period = requireRecord(item.reportingPeriod, "reporting period");
  const enterprise = requireRecord(item.enterprise, "report enterprise");
  const site = requireRecord(item.site, "report site");
  const revision = requireRevision(item.currentRevision);
  if (
    item.classification !== "official" ||
    !isWorkflowState(item.workflowState) ||
    typeof item.enterpriseReportId !== "string" ||
    typeof item.currentRevisionId !== "string" ||
    typeof period.reportingPeriodId !== "string" ||
    typeof period.label !== "string" ||
    typeof period.startsAt !== "string" ||
    typeof period.endsAt !== "string" ||
    typeof enterprise.enterpriseId !== "string" ||
    typeof site.siteId !== "string"
  ) {
    throw new Error("The report history item has an invalid target identity or scope.");
  }
  return { ...(item as EnterpriseReportHistoryItem), currentRevision: revision };
}

function requireRevision(value: unknown): EnterpriseReportRevisionSummary {
  const revision = requireRecord(value, "report revision");
  if (
    typeof revision.reportRevisionId !== "string" ||
    typeof revision.localRevisionId !== "string" ||
    typeof revision.submittedAt !== "string" ||
    !Array.isArray(revision.metrics)
  ) {
    throw new Error("The report revision is missing its durable identity or facts.");
  }
  return revision as EnterpriseReportRevisionSummary;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isWorkflowState(value: unknown): value is ReportWorkflowState {
  return value === "submitted" || value === "returned" || value === "accepted" || value === "consolidated";
}
