import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterpriseReportDetailFixture, enterpriseReportFixture, finalReportDetailFixture, periodFixture } from "@/features/reports/testFixtures";
import { apiClient } from "../lib/apiClient";
import {
  collectCursorPages,
  fetchFinalReportArtifact,
  finalizeReports,
  listAllEnterpriseReports,
  listAllReportingPeriods,
  readEnterpriseReport,
  readFinalReportArtifact,
  readFinalReport,
  runReportingPeriodLifecycle,
  transitionEnterpriseReport,
} from "./reporting";

vi.mock("../lib/apiClient", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);

describe("reporting v2 service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("collects every keyset page without a 500-row cap", async () => {
    const cursors = ["cursor-1", "cursor-2", "cursor-3", "cursor-4", "cursor-5"];
    const readPage = vi.fn(async (cursor?: string) => {
      const pageIndex = cursor ? cursors.indexOf(cursor) + 1 : 0;
      return {
        items: Array.from({ length: 100 }, (_, index) => pageIndex * 100 + index),
        page: { hasMore: pageIndex < 5, nextCursor: pageIndex < 5 ? cursors[pageIndex]! : null },
      };
    });

    const items = await collectCursorPages(readPage, "test resource");

    expect(items).toHaveLength(600);
    expect(items[0]).toBe(0);
    expect(items[599]).toBe(599);
    expect(readPage).toHaveBeenCalledTimes(6);
    expect(readPage.mock.calls.map((call) => call[0])).toEqual([undefined, ...cursors]);
  });

  it("rejects repeated cursors instead of looping or truncating", async () => {
    await expect(collectCursorPages(async () => ({ items: [], page: { hasMore: true, nextCursor: "same-cursor" } }), "test resource")).rejects.toThrow("repeated continuation cursor");
  });

  it("loads official report pages with filters and follows the backend cursor", async () => {
    const item = enterpriseReportFixture();
    mockedGet
      .mockResolvedValueOnce({ data: { contractVersion: 2, classification: "official", items: [item], page: { limit: 100, returnedCount: 1, hasMore: true, nextCursor: "next" } } })
      .mockResolvedValueOnce({ data: { contractVersion: 2, classification: "official", items: [], page: { limit: 100, returnedCount: 0, hasMore: false, nextCursor: null } } });

    const result = await listAllEnterpriseReports({ reportingPeriodId: item.reportingPeriod.reportingPeriodId, workflowState: "accepted" });

    expect(result).toEqual([item]);
    expect(mockedGet).toHaveBeenNthCalledWith(1, "/operational/reports/v2", { params: { reportingPeriodId: item.reportingPeriod.reportingPeriodId, workflowState: "accepted", limit: 100 } });
    expect(mockedGet).toHaveBeenNthCalledWith(2, "/operational/reports/v2", {
      params: { reportingPeriodId: item.reportingPeriod.reportingPeriodId, workflowState: "accepted", limit: 100, cursor: "next" },
    });
  });

  it("discovers only canonical Staff periods and runs lifecycle without client clock or period data", async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        items: [periodFixture],
        page: { limit: 100, returnedCount: 1, hasMore: false, nextCursor: null },
      },
    });

    await expect(listAllReportingPeriods({ periodStatus: "closed" })).resolves.toEqual([periodFixture]);
    expect(mockedGet).toHaveBeenCalledWith("/operational/reporting-periods/v2", {
      params: { periodStatus: "closed", limit: 100 },
    });

    const lifecycle = {
      contractVersion: 2 as const,
      evaluatedAt: "2026-07-13T04:00:00Z",
      ensuredPeriodCount: 1,
      createdCount: 0,
      transitionedCount: 1,
      frozenCount: 1,
      periods: [periodFixture],
    };
    mockedPost.mockResolvedValueOnce({ data: lifecycle });

    await expect(runReportingPeriodLifecycle()).resolves.toEqual(lifecycle);
    expect(mockedPost).toHaveBeenCalledWith("/operational/reporting-periods/lifecycle/run/v2");
  });

  it("resolves the selected report ID through detail and fails closed on a mismatched resource", async () => {
    const detail = enterpriseReportDetailFixture();
    mockedGet.mockResolvedValueOnce({ data: detail });
    await expect(readEnterpriseReport(detail.enterpriseReportId)).resolves.toEqual(detail);
    expect(mockedGet).toHaveBeenCalledWith(`/operational/reports/${detail.enterpriseReportId}/v2`);

    mockedGet.mockResolvedValueOnce({ data: { ...detail, enterpriseReportId: "different-report" } });
    await expect(readEnterpriseReport(detail.enterpriseReportId)).rejects.toThrow("did not match the requested");
  });

  it("requests and validates an exact immutable final-report version", async () => {
    const detail = finalReportDetailFixture();
    mockedGet.mockResolvedValueOnce({ data: detail });

    await expect(readFinalReport(detail.reportFinalizationId, detail.selectedVersionId)).resolves.toEqual(detail);
    expect(mockedGet).toHaveBeenCalledWith(`/operational/reports/finalizations/${detail.reportFinalizationId}/v2`, { params: { versionId: detail.selectedVersionId } });

    mockedGet.mockResolvedValueOnce({ data: { ...detail, selectedVersionId: "different-version" } });
    await expect(readFinalReport(detail.reportFinalizationId, detail.selectedVersionId)).rejects.toThrow("immutable version");
  });

  it("downloads only an exact, ready, byte-verified official final artifact", async () => {
    const detail = finalReportDetailFixture();
    const artifact = detail.selectedVersion.artifacts[0]!;
    const bytes = "official-pdf-bytes";
    const contentHash = "sha256:0a4650523390a147fa0517829b5087c5909db8cda3987c9e6858bca3549652ad";
    const metadata = {
      ...artifact,
      contractVersion: 2 as const,
      reportFinalizationId: detail.reportFinalizationId,
      finalReportVersionId: detail.selectedVersionId,
      contentHash,
      sizeBytes: 18,
    };
    mockedGet.mockResolvedValueOnce({ data: metadata }).mockResolvedValueOnce({
      data: new Blob([bytes], { type: "application/pdf" }),
      headers: { "content-length": "18", "content-type": "application/pdf", etag: `"${contentHash}"` },
    });

    const downloaded = await fetchFinalReportArtifact(detail.reportFinalizationId, detail.selectedVersionId, artifact.artifactId);

    expect(downloaded.contentHash).toBe(contentHash);
    expect(downloaded.sizeBytes).toBe(18);
    expect(mockedGet).toHaveBeenNthCalledWith(1, `/operational/reports/finalizations/${detail.reportFinalizationId}/artifacts/${artifact.artifactId}/v2`);
    expect(mockedGet).toHaveBeenNthCalledWith(2, `/operational/reports/finalizations/${detail.reportFinalizationId}/artifacts/${artifact.artifactId}/download/v2`, { responseType: "blob" });
  });

  it("fails closed on mismatched artifact identity and corrupted artifact bytes", async () => {
    const detail = finalReportDetailFixture();
    const artifact = detail.selectedVersion.artifacts[0]!;
    const contentHash = "sha256:0a4650523390a147fa0517829b5087c5909db8cda3987c9e6858bca3549652ad";
    const metadata = {
      ...artifact,
      contractVersion: 2 as const,
      reportFinalizationId: detail.reportFinalizationId,
      finalReportVersionId: detail.selectedVersionId,
      contentHash,
      sizeBytes: 18,
    };

    mockedGet.mockResolvedValueOnce({ data: { ...metadata, finalReportVersionId: "different-version" } });
    await expect(readFinalReportArtifact(detail.reportFinalizationId, detail.selectedVersionId, artifact.artifactId)).rejects.toThrow("did not match");

    mockedGet.mockResolvedValueOnce({ data: metadata }).mockResolvedValueOnce({
      data: new Blob(["tampered-pdf-bytes"], { type: "application/pdf" }),
      headers: { "content-length": "18", "content-type": "application/pdf", etag: `"${contentHash}"` },
    });
    await expect(fetchFinalReportArtifact(detail.reportFinalizationId, detail.selectedVersionId, artifact.artifactId)).rejects.toThrow("SHA-256");
  });

  it("uses version-checked v2 transitions and exact-revision finalization commands", async () => {
    const report = enterpriseReportFixture();
    const transitionCommand = { contractVersion: 2 as const, commandId: "command-transition", expectedVersion: report.logicalVersion, action: "accept_revision" as const, reason: null };
    const transitionAck = {
      contractVersion: 2 as const,
      commandId: transitionCommand.commandId,
      disposition: "applied" as const,
      acknowledgedAt: "2026-08-01T02:00:00Z",
      resource: { enterpriseReportId: report.enterpriseReportId, reportRevisionId: report.currentRevisionId, workflowState: "accepted" as const, logicalVersion: 3 },
    };
    mockedPost.mockResolvedValueOnce({ data: transitionAck });

    await expect(transitionEnterpriseReport(report.enterpriseReportId, transitionCommand)).resolves.toEqual(transitionAck);

    const finalCommand = {
      contractVersion: 2 as const,
      commandId: "command-final",
      idempotencyKey: "final-report:period:command-final",
      occurredAt: "2026-08-02T01:00:00Z",
      expectedVersion: 0,
      payload: {
        targetFinalizationId: null,
        reportingPeriodId: report.reportingPeriod.reportingPeriodId,
        scope: { type: "enterprise_selection" as const, barangay: null },
        reportRevisionIds: [report.acceptedRevisionId!],
        reason: null,
      },
    };
    const finalAck = {
      contractVersion: 2 as const,
      commandId: finalCommand.commandId,
      disposition: "created" as const,
      payloadHash: `sha256:${"9".repeat(64)}`,
      acknowledgedAt: "2026-08-02T01:00:01Z",
      resource: {
        reportFinalizationId: "finalization-1",
        finalReportVersionId: "version-1",
        reportCode: "FINAL-1",
        reportingPeriodId: report.reportingPeriod.reportingPeriodId,
        classification: "official" as const,
        versionNumber: 1,
        logicalVersion: 1,
        scopeType: "enterprise_selection" as const,
        scopeLabel: "Selected enterprises (1)",
        sourceCount: 1,
        artifactStatus: "pending" as const,
      },
    };
    mockedPost.mockResolvedValueOnce({ data: finalAck });

    await expect(finalizeReports(finalCommand)).resolves.toEqual(finalAck);
    expect(mockedPost).toHaveBeenNthCalledWith(1, `/operational/reports/${report.enterpriseReportId}/transitions/v2`, transitionCommand);
    expect(mockedPost).toHaveBeenNthCalledWith(2, "/operational/reports/finalizations/v2", finalCommand);
  });

  it("fails closed when a backend metric is not an exact decimal string", async () => {
    const detail = enterpriseReportDetailFixture();
    const unsafeDetail = structuredClone(detail) as EnterpriseReportDetailWithUnsafeMetric;
    unsafeDetail.currentRevision.metrics[0]!.value = 0.1;
    unsafeDetail.revisions[0]!.metrics[0]!.value = 0.1;
    mockedGet.mockResolvedValueOnce({ data: unsafeDetail });

    await expect(readEnterpriseReport(detail.enterpriseReportId)).rejects.toThrow("exact decimal string");

    const finalDetail = finalReportDetailFixture();
    const unsafeFinal = structuredClone(finalDetail) as FinalReportDetailWithUnsafeMetric;
    unsafeFinal.selectedVersion.metrics[0]!.value = 0.1;
    mockedGet.mockResolvedValueOnce({ data: unsafeFinal });

    await expect(readFinalReport(finalDetail.reportFinalizationId)).rejects.toThrow("exact decimal string");
  });

  it("rejects removed report and final-report contract values at runtime", async () => {
    const report = structuredClone(enterpriseReportDetailFixture());
    (report.obligation as { eligibilityBasis: string }).eligibilityBasis = "legacy_submission";
    mockedGet.mockResolvedValueOnce({ data: report });

    await expect(readEnterpriseReport(report.enterpriseReportId)).rejects.toThrow("removed or incomplete report contract value");

    const reportEvent = structuredClone(enterpriseReportDetailFixture());
    (reportEvent.reviewEvents[0] as { eventType: string }).eventType = "legacy_state_imported";
    mockedGet.mockResolvedValueOnce({ data: reportEvent });

    await expect(readEnterpriseReport(reportEvent.enterpriseReportId)).rejects.toThrow("unsupported review event type");

    const finalReport = structuredClone(finalReportDetailFixture());
    (finalReport.events[0] as { eventType: string }).eventType = "legacy_final_imported";
    mockedGet.mockResolvedValueOnce({ data: finalReport });

    await expect(readFinalReport(finalReport.reportFinalizationId)).rejects.toThrow("unsupported lifecycle event type");
  });
});

type EnterpriseReportDetailWithUnsafeMetric = {
  currentRevision: { metrics: Array<{ value: string | number | null }> };
  revisions: Array<{ metrics: Array<{ value: string | number | null }> }>;
};

type FinalReportDetailWithUnsafeMetric = {
  selectedVersion: { metrics: Array<{ value: string | number | null }> };
};
