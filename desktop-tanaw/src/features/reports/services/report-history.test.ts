import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../../lib/axios", () => ({ staffApi: { get } }));

import { listEnterpriseReportHistory, readEnterpriseReport } from "./report-history";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enterprise report history v2", () => {
  it("follows every target cursor without accepting a truncated history", async () => {
    const first = historyItem("report-1", "revision-1");
    const second = historyItem("report-2", "revision-2");
    get.mockResolvedValueOnce({ data: page([first], true, "cursor-2") }).mockResolvedValueOnce({ data: page([second], false, null) });

    await expect(listEnterpriseReportHistory()).resolves.toEqual([first, second]);

    expect(get).toHaveBeenNthCalledWith(1, "/operational/enterprise/reports/v2", { params: { limit: 100 } });
    expect(get).toHaveBeenNthCalledWith(2, "/operational/enterprise/reports/v2", { params: { limit: 100, cursor: "cursor-2" } });
  });

  it("fails closed when pagination claims more data without a cursor", async () => {
    get.mockResolvedValue({ data: page([historyItem("report-1", "revision-1")], true, null) });

    await expect(listEnterpriseReportHistory()).rejects.toThrow("omitted its required continuation cursor");
  });

  it("reads immutable detail by encoded central report identity", async () => {
    const item = historyItem("report/one", "revision-1");
    const detail = {
      ...item,
      contractVersion: 2,
      revisions: [{ ...item.currentRevision, notes: "Verified", demographics: [] }],
      reviewEvents: [],
    };
    get.mockResolvedValue({ data: detail });

    await expect(readEnterpriseReport("report/one")).resolves.toEqual(detail);
    expect(get).toHaveBeenCalledWith("/operational/enterprise/reports/report%2Fone/v2");
  });
});

function page(items: ReturnType<typeof historyItem>[], hasMore: boolean, nextCursor: string | null) {
  return {
    contractVersion: 2,
    classification: "official",
    items,
    page: { limit: 100, returnedCount: items.length, hasMore, nextCursor },
  };
}

function historyItem(enterpriseReportId: string, localRevisionId: string) {
  return {
    enterpriseReportId,
    classification: "official",
    workflowState: "submitted",
    logicalVersion: 1,
    currentRevisionId: "11111111-1111-4111-8111-111111111111",
    acceptedRevisionId: null,
    includedInOfficialTotals: false,
    acceptanceBlocked: false,
    reportingPeriod: {
      reportingPeriodId: "22222222-2222-4222-8222-222222222222",
      naturalKey: "month:Asia/Manila:2026-07",
      label: "July 2026",
      startsAt: "2026-06-30T16:00:00Z",
      endsAt: "2026-07-31T16:00:00Z",
    },
    enterprise: {
      enterpriseId: "33333333-3333-4333-8333-333333333333",
      enterpriseCode: "ENT-001",
      enterpriseName: "Enterprise One",
      category: null,
    },
    site: {
      siteId: "44444444-4444-4444-8444-444444444444",
      siteCode: "PRIMARY",
      siteName: "Primary Site",
      frozenBarangay: "Poblacion",
    },
    currentRevision: {
      reportRevisionId: "55555555-5555-4555-8555-555555555555",
      localRevisionId,
      revisionNumber: 1,
      submittedAt: "2026-08-01T00:00:00Z",
      receivedAt: "2026-08-01T00:00:01Z",
      evidenceStatus: "complete",
      acceptanceBlocked: false,
      metrics: [],
    },
    createdAt: "2026-08-01T00:00:01Z",
    updatedAt: "2026-08-01T00:00:01Z",
  } as const;
}
