import { beforeEach, describe, expect, it, vi } from "vitest";

const { post, getMlServiceStatus, listReadySyncOutboxItems, acknowledgeSyncOutboxItem, recordSyncOutboxFailure, listLocalReportSubmissions, listEnterpriseFinalReports } = vi.hoisted(() => ({
  post: vi.fn(),
  getMlServiceStatus: vi.fn(),
  listReadySyncOutboxItems: vi.fn(),
  acknowledgeSyncOutboxItem: vi.fn(),
  recordSyncOutboxFailure: vi.fn(),
  listLocalReportSubmissions: vi.fn(),
  listEnterpriseFinalReports: vi.fn(),
}));

vi.mock("../../../lib/axios", () => ({ staffApi: { post } }));
vi.mock("../../camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "tanaw-ml://local",
  getMlServiceStatus,
  listReadySyncOutboxItems,
  acknowledgeSyncOutboxItem,
  recordSyncOutboxFailure,
  listLocalReportSubmissions,
}));
vi.mock("../../reports/services/report-history", () => ({ listEnterpriseFinalReports }));

import { syncDesktopReportSubmission, syncDesktopReportSubmissions } from "./cloud-sync";

const OUTBOX_ENDPOINT = "/operational/desktop/report-submissions/v2";

beforeEach(() => {
  vi.clearAllMocks();
  getMlServiceStatus.mockResolvedValue({ baseUrl: "tanaw-ml://local", error: null, pid: 123, running: true });
  listLocalReportSubmissions.mockResolvedValue([]);
  listEnterpriseFinalReports.mockResolvedValue([]);
  acknowledgeSyncOutboxItem.mockResolvedValue({ acknowledged: true });
  recordSyncOutboxFailure.mockResolvedValue({ status: "retry" });
});

describe("durable report outbox delivery", () => {
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
    listLocalReportSubmissions.mockResolvedValue([{ report_id: "REP-2026-06", outbox_item_id: item.outbox_item_id, sync_status: "pending_cloud_sync" }]);

    await expect(syncDesktopReportSubmission("REP-2026-06", item.outbox_item_id)).rejects.toThrow("exact report revision remains queued");

    expect(post).not.toHaveBeenCalled();
    expect(acknowledgeSyncOutboxItem).not.toHaveBeenCalled();
  });

  it("rejects a report that has no exact local outbox revision", async () => {
    listLocalReportSubmissions.mockResolvedValue([]);

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
