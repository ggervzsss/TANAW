import { describe, expect, it } from "vitest";
import { ML_OPERATION_NAMES, isMlOperation, resolveMlOperationRequest } from "./ml-ipc-contract";

describe("ML IPC operation allowlist", () => {
  it("rejects arbitrary routes, methods, and raw command names", () => {
    for (const value of ["fetch", "http://127.0.0.1:8765/health", "/camera/start", "shell", { operation: "camera.stop" }]) {
      expect(isMlOperation(value)).toBe(false);
      expect(() => resolveMlOperationRequest(value, undefined)).toThrow("Unsupported ML service operation");
    }
  });

  it("resolves named operations to fixed routes", () => {
    expect(resolveMlOperationRequest("camera.stop", undefined)).toEqual({ method: "POST", path: "/camera/stop" });
    expect(resolveMlOperationRequest("reports.purgeRaw", {
      reportId: "report/id",
      consolidatedRevisionId: "11111111-1111-4111-8111-111111111111",
    })).toEqual({
      method: "POST",
      path: "/reports/local/report%2Fid/purge-raw",
      body: JSON.stringify({ consolidated_revision_id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(resolveMlOperationRequest("metrics.summary", { includeSubmitted: true })).toEqual({
      method: "GET",
      path: "/metrics/summary?include_submitted=true",
    });
  });

  it("maps only exact outbox acknowledgement and failure operations", () => {
    const outboxItemId = "11111111-1111-4111-8111-111111111111";
    expect(resolveMlOperationRequest("sync.outbox.health", undefined)).toEqual({ method: "GET", path: "/sync/outbox/health" });
    expect(resolveMlOperationRequest("sync.outbox.ready", { limit: 25 })).toEqual({ method: "GET", path: "/sync/outbox/ready?limit=25" });
    expect(resolveMlOperationRequest("sync.outbox.acknowledge", { outboxItemId, acknowledgement: { contractVersion: 2 } })).toEqual({
      method: "POST",
      path: `/sync/outbox/${outboxItemId}/acknowledge`,
      body: JSON.stringify({ acknowledgement: { contractVersion: 2 } }),
    });
    expect(resolveMlOperationRequest("sync.outbox.failure", { outboxItemId, error_class: "network", error_message: "offline", retryable: true, http_status: null })).toEqual({
      method: "POST",
      path: `/sync/outbox/${outboxItemId}/failure`,
      body: JSON.stringify({ error_class: "network", error_message: "offline", retryable: true, http_status: null }),
    });
    expect(() => resolveMlOperationRequest("sync.outbox.acknowledge", { outboxItemId: "report-id", acknowledgement: {} })).toThrow("outbox identifier");
  });

  it("never accepts camera credentials in a camera control payload", () => {
    expect(() =>
      resolveMlOperationRequest("camera.start", {
        cameraId: 1,
        credentialScope: "enterprise-1",
        body: { camera_id: 1, stream_url: "rtsp://camera", password: "secret" },
      }),
    ).toThrow("unsupported field");
    expect(() =>
      resolveMlOperationRequest("camera.test", {
        cameraId: 1,
        credentialScope: "enterprise-1",
        body: { camera_type: "RTSP_CCTV", stream_url: "rtsp://admin:secret@camera.local/stream" },
      }),
    ).toThrow("must not be embedded");
  });

  it("rejects extra body fields and unbounded identifiers", () => {
    expect(() =>
      resolveMlOperationRequest("camera.test", {
        cameraId: 1,
        credentialScope: "enterprise-1",
        body: { stream_url: "rtsp://camera", arbitraryUrl: "http://attacker" },
      }),
    ).toThrow("unsupported field");
    expect(() => resolveMlOperationRequest("reports.purgeRaw", {
      reportId: "x".repeat(241),
      consolidatedRevisionId: "11111111-1111-4111-8111-111111111111",
    })).toThrow("report identifier");
    expect(() => resolveMlOperationRequest("reports.purgeRaw", {
      reportId: "report-1",
      consolidatedRevisionId: "not-a-revision",
    })).toThrow("consolidated revision");
  });

  it("allows only canonical reporting period identity and bounds on report submission", () => {
    const canonicalBody = {
      report_id: "REP-JUNE",
      period_id: "month:Asia/Manila:2026-06",
      source_window: {
        start: "2026-05-31T16:00:00Z",
        end: "2026-06-30T16:00:00Z",
      },
      metrics: null,
      notes: null,
      payload: {},
    };

    expect(resolveMlOperationRequest("reports.createRevision", canonicalBody)).toEqual({
      method: "POST",
      path: "/reports/local",
      body: JSON.stringify(canonicalBody),
    });
    expect(() =>
      resolveMlOperationRequest("reports.createRevision", {
        ...canonicalBody,
        period_id: undefined,
        period: "Jun 1 - Jun 30, 2026",
      }),
    ).toThrow("unsupported field");
  });

  it("contains no generic operation capable of selecting a URL", () => {
    expect(ML_OPERATION_NAMES.some((operation) => /fetch|request|url|command|shell/i.test(operation))).toBe(false);
  });
});
