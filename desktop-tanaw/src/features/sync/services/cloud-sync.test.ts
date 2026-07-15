import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  post,
  get,
  getMlServiceStatus,
  getLocalMetricsSummary,
  getSimulationStatus,
  prepareLocalMockCounts,
  resetLocalMockData,
  listReadySyncOutboxItems,
  acknowledgeSyncOutboxItem,
  recordSyncOutboxFailure,
  listLocalReports,
  purgeLocalReportRawEvents,
  listEnterpriseReportHistory,
} = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  getMlServiceStatus: vi.fn(),
  getLocalMetricsSummary: vi.fn(),
  getSimulationStatus: vi.fn(),
  prepareLocalMockCounts: vi.fn(),
  resetLocalMockData: vi.fn(),
  listReadySyncOutboxItems: vi.fn(),
  acknowledgeSyncOutboxItem: vi.fn(),
  recordSyncOutboxFailure: vi.fn(),
  listLocalReports: vi.fn(),
  purgeLocalReportRawEvents: vi.fn(),
  listEnterpriseReportHistory: vi.fn(),
}));

vi.mock("../../../lib/axios", () => ({ staffApi: { get, post } }));
vi.mock("../../camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "tanaw-ml://local",
  getMlServiceStatus,
  getLocalMetricsSummary,
  getSimulationStatus,
  prepareLocalMockCounts,
  resetLocalMockData,
  listReadySyncOutboxItems,
  acknowledgeSyncOutboxItem,
  recordSyncOutboxFailure,
  listLocalReports,
  purgeLocalReportRawEvents,
}));
vi.mock("../../reports/services/report-history", () => ({ listEnterpriseReportHistory }));

import { prepareDesktopMockCounts, syncDesktopReportSubmission, syncDesktopReportSubmissions } from "./cloud-sync";

const OUTBOX_ENDPOINT = "/operational/desktop/report-submissions/v2";

beforeEach(() => {
  vi.clearAllMocks();
  getMlServiceStatus.mockResolvedValue({ baseUrl: "tanaw-ml://local", error: null, pid: 123, running: true });
  getSimulationStatus.mockResolvedValue(null);
  prepareLocalMockCounts.mockResolvedValue({ prepared: true });
  listLocalReports.mockResolvedValue([]);
  listEnterpriseReportHistory.mockResolvedValue([]);
  acknowledgeSyncOutboxItem.mockResolvedValue({ acknowledged: true });
  recordSyncOutboxFailure.mockResolvedValue({ status: "retry" });
  purgeLocalReportRawEvents.mockResolvedValue({ purged: true });
});

describe("canonical mock preparation periods", () => {
  const juneCounts = {
    entries: 10,
    exits: 3,
    uniqueCount: 8,
    peakOccupancy: 7,
    period: "Jun 1 - Jun 30, 2026",
    periodKey: "month:Asia/Manila:2026-06",
    sourceWindow: {
      start: "2026-05-31T16:00:00Z",
      end: "2026-06-30T16:00:00Z",
    },
  };

  it("prepares an explicitly selected canonical period and forwards its exact bounds", async () => {
    get.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "active",
        enterpriseId: "enterprise-1",
        enterpriseName: "Enterprise One",
        counts: juneCounts,
        pendingCounts: [juneCounts],
      },
    });

    await prepareDesktopMockCounts(juneCounts.periodKey);

    expect(getLocalMetricsSummary).not.toHaveBeenCalled();
    expect(prepareLocalMockCounts).toHaveBeenCalledWith("tanaw-ml://local", {
      mockRunId: "run-1",
      enterpriseId: "enterprise-1",
      enterpriseName: "Enterprise One",
      entries: 10,
      exits: 3,
      uniqueCount: 8,
      peakOccupancy: 7,
      periodId: juneCounts.periodKey,
      startsAtUtc: "2026-05-31T16:00:00.000Z",
      endsAtUtc: "2026-06-30T16:00:00.000Z",
    });
  });

  it("does not choose a device-clock month when the local ledger is unclassified", async () => {
    get.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "active",
        enterpriseId: "enterprise-1",
        enterpriseName: "Enterprise One",
        counts: juneCounts,
        pendingCounts: [juneCounts],
      },
    });
    getLocalMetricsSummary.mockResolvedValue({ period_id: null, period: null });

    await expect(prepareDesktopMockCounts()).resolves.toBeNull();

    expect(prepareLocalMockCounts).not.toHaveBeenCalled();
  });

  it("rejects prepared counts whose display label has no canonical identity", async () => {
    get.mockResolvedValue({
      data: {
        runId: "run-1",
        status: "active",
        enterpriseId: "enterprise-1",
        enterpriseName: "Enterprise One",
        counts: { ...juneCounts, periodKey: undefined },
      },
    });

    await expect(prepareDesktopMockCounts("month:Asia/Manila:2026-06")).rejects.toThrow("No canonical reporting period");
    expect(prepareLocalMockCounts).not.toHaveBeenCalled();
  });
});

describe("durable report outbox delivery", () => {
  it("purges raw events only for the exact consolidated central revision", async () => {
    listReadySyncOutboxItems.mockResolvedValue([]);
    listLocalReports.mockResolvedValue([
      { report_id: "local-report-1", revision_id: "revision-1", raw_purged_at: null },
      { report_id: "local-report-2", revision_id: "revision-2", raw_purged_at: null },
    ]);
    listEnterpriseReportHistory.mockResolvedValue([
      { workflowState: "consolidated", currentRevision: { localRevisionId: "revision-1" } },
      { workflowState: "accepted", currentRevision: { localRevisionId: "revision-2" } },
    ]);

    await expect(syncDesktopReportSubmissions()).resolves.toBe(0);

    expect(purgeLocalReportRawEvents).toHaveBeenCalledTimes(1);
    expect(purgeLocalReportRawEvents).toHaveBeenCalledWith("tanaw-ml://local", "local-report-1", "revision-1");
  });

  it("acknowledges only the exact successful item and continues after a deterministic failure", async () => {
    const first = outboxItem("11111111-1111-4111-8111-111111111111");
    const second = outboxItem("22222222-2222-4222-8222-222222222222");
    const acknowledgement = acknowledgementFor(second, "created");
    listReadySyncOutboxItems.mockResolvedValue([first, second]);
    post.mockRejectedValueOnce({ response: { status: 422 } }).mockResolvedValueOnce({ data: acknowledgement });

    await expect(syncDesktopReportSubmissions()).resolves.toBe(1);

    expect(recordSyncOutboxFailure).toHaveBeenCalledWith("tanaw-ml://local", first.outbox_item_id, {
      errorClass: "http_422",
      errorMessage: "The central report service returned HTTP 422.",
      retryable: false,
      httpStatus: 422,
    });
    expect(acknowledgeSyncOutboxItem).toHaveBeenCalledTimes(1);
    expect(acknowledgeSyncOutboxItem).toHaveBeenCalledWith("tanaw-ml://local", second.outbox_item_id, acknowledgement);
  });

  it("dead-letters an unapproved local endpoint without making a cloud request", async () => {
    const item = { ...outboxItem("33333333-3333-4333-8333-333333333333"), endpoint: "/legacy/report-submit" };
    listReadySyncOutboxItems.mockResolvedValue([item]);

    await expect(syncDesktopReportSubmissions()).resolves.toBe(0);

    expect(post).not.toHaveBeenCalled();
    expect(recordSyncOutboxFailure).toHaveBeenCalledWith("tanaw-ml://local", item.outbox_item_id, {
      errorClass: "invalid_outbox_contract",
      errorMessage: "The local outbox item does not target the approved report v2 endpoint.",
      retryable: false,
    });
  });

  it.each(["commandId", "payloadHash"] as const)("dead-letters a mismatched %s without acknowledging locally", async (field) => {
    const item = outboxItem("44444444-4444-4444-8444-444444444444");
    const acknowledgement = acknowledgementFor(item, "created");
    acknowledgement[field] = field === "commandId" ? "55555555-5555-4555-8555-555555555555" : `sha256:${"b".repeat(64)}`;
    listReadySyncOutboxItems.mockResolvedValue([item]);
    post.mockResolvedValue({ data: acknowledgement });

    await expect(syncDesktopReportSubmissions()).resolves.toBe(0);

    expect(acknowledgeSyncOutboxItem).not.toHaveBeenCalled();
    expect(recordSyncOutboxFailure).toHaveBeenCalledWith("tanaw-ml://local", item.outbox_item_id, {
      errorClass: "acknowledgement_mismatch",
      errorMessage: "The central acknowledgement did not match the exact local outbox command.",
      retryable: false,
    });
  });

  it("converges through a replayed central acknowledgement after the first local acknowledgement is lost", async () => {
    const item = outboxItem("66666666-6666-4666-8666-666666666666");
    listReadySyncOutboxItems.mockResolvedValue([item]);
    post.mockResolvedValueOnce({ data: acknowledgementFor(item, "created") }).mockResolvedValueOnce({ data: acknowledgementFor(item, "replayed") });
    acknowledgeSyncOutboxItem.mockRejectedValueOnce(new Error("local bridge interrupted")).mockResolvedValueOnce({ acknowledged: true });

    await expect(syncDesktopReportSubmissions()).resolves.toBe(0);
    await expect(syncDesktopReportSubmissions()).resolves.toBe(1);

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, OUTBOX_ENDPOINT, item.payload);
    expect(post).toHaveBeenNthCalledWith(2, OUTBOX_ENDPOINT, item.payload);
    expect(recordSyncOutboxFailure).toHaveBeenCalledWith("tanaw-ml://local", item.outbox_item_id, {
      errorClass: "local_acknowledgement_error",
      errorMessage: "The central commit succeeded, but its acknowledgement was not recorded locally.",
      retryable: true,
    });
    expect(acknowledgeSyncOutboxItem).toHaveBeenLastCalledWith("tanaw-ml://local", item.outbox_item_id, acknowledgementFor(item, "replayed"));
  });

  it("delivers the exact outbox item supplied by the report submission response", async () => {
    const item = outboxItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const acknowledgement = acknowledgementFor(item, "created");
    listReadySyncOutboxItems.mockResolvedValue([item]);
    post.mockResolvedValue({ data: acknowledgement });

    await expect(syncDesktopReportSubmission("REP-2026-06", item.outbox_item_id)).resolves.toBe(1);

    expect(listReadySyncOutboxItems).toHaveBeenCalledWith("tanaw-ml://local", 500);
    expect(acknowledgeSyncOutboxItem).toHaveBeenCalledWith("tanaw-ml://local", item.outbox_item_id, acknowledgement);
  });

  it("throws an explicit pending result when the exact outbox item is not ready", async () => {
    const item = outboxItem("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    listReadySyncOutboxItems.mockResolvedValue([]);
    listLocalReports.mockResolvedValue([{ report_id: "REP-2026-06", outbox_item_id: item.outbox_item_id, sync_status: "pending_cloud_sync" }]);

    await expect(syncDesktopReportSubmission("REP-2026-06", item.outbox_item_id)).rejects.toThrow("exact report revision remains queued");

    expect(post).not.toHaveBeenCalled();
    expect(acknowledgeSyncOutboxItem).not.toHaveBeenCalled();
  });

  it("rejects a report that has no exact local outbox revision", async () => {
    listLocalReports.mockResolvedValue([]);

    await expect(syncDesktopReportSubmission("REP-WITHOUT-OUTBOX")).rejects.toThrow("no exact local outbox revision");

    expect(listReadySyncOutboxItems).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

function outboxItem(outboxItemId: string) {
  const commandId = outboxItemId;
  return {
    outbox_item_id: outboxItemId,
    report_revision_id: outboxItemId,
    command_id: commandId,
    idempotency_key: `report:${outboxItemId}`,
    endpoint: OUTBOX_ENDPOINT,
    contract_version: 2,
    payload: { contractVersion: 2, commandId },
    payload_hash: `sha256:${"a".repeat(64)}`,
    status: "ready" as const,
    created_at: "2026-07-13T08:15:00Z",
    next_attempt_at: "2026-07-13T08:15:00Z",
    attempt_count: 0,
    last_attempt_at: null,
    last_error_class: null,
    last_error_message: null,
    acknowledged_at: null,
    acknowledgement: {},
  };
}

function acknowledgementFor(item: ReturnType<typeof outboxItem>, disposition: "created" | "replayed") {
  return {
    contractVersion: 2,
    commandId: item.command_id,
    disposition,
    payloadHash: item.payload_hash,
    acknowledgedAt: "2026-07-13T08:15:03.510Z",
    resource: {
      periodKey: "month:Asia/Manila:2026-06",
      reportingPeriodId: "77777777-7777-4777-8777-777777777777",
      enterpriseReportId: "88888888-8888-4888-8888-888888888888",
      reportRevisionId: "99999999-9999-4999-8999-999999999999",
      revisionNumber: 1,
      workflowState: "submitted",
      logicalVersion: 1,
    },
  };
}
