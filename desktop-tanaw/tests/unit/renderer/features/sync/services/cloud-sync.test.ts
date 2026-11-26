import { AxiosError, type AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffApi } from "../../../../../../src/lib/axios";
import {
  getEstablishmentLive,
  getEstablishmentSummary,
  getMlServiceStatus,
  getMlCameraStates,
  getMlHealth,
  getMlSession,
  markLocalEventsSynced,
  listLocalCameras,
  getLocalMetricsSummary,
  listLocalReportSubmissions,
  markLocalReportSynced,
  markLocalReportUploadRejected,
  prepareLocalSampleCounts,
  type LocalReportSubmissionRecord,
} from "../../../../../../src/features/camera/services/ml-service";
import { DESKTOP_SAMPLE_PREPARED_EVENT, isRefusedUpload, refusedUploadReason, syncDesktopTelemetry, prepareDesktopSampleCounts, syncDesktopReportSubmission, syncDesktopReportSubmissions } from "../../../../../../src/features/sync/services/cloud-sync";

vi.mock("../../../../../../src/lib/axios", () => ({
  staffApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../../../../../../src/features/camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "http://127.0.0.1:8765",
  getEstablishmentLive: vi.fn(),
  getEstablishmentSummary: vi.fn(),
  getLocalMetricsSummary: vi.fn(),
  getMlCameraStates: vi.fn(),
  getMlHealth: vi.fn(),
  getMlServiceStatus: vi.fn(),
  getMlSession: vi.fn(),
  listLocalCameras: vi.fn(),
  listLocalReportSubmissions: vi.fn(),
  markLocalEventsSynced: vi.fn(),
  markLocalReportSynced: vi.fn(),
  markLocalReportUploadRejected: vi.fn(),
  prepareLocalSampleCounts: vi.fn(),
  purgeLocalReportRawEvents: vi.fn(),
}));

vi.mock("../../../../../../src/features/reports/services/report-history", () => ({
  listEnterpriseFinalReports: vi.fn().mockResolvedValue([]),
}));

describe("desktop report cloud idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMlServiceStatus).mockResolvedValue({
      baseUrl: "http://127.0.0.1:8765",
      desktopBuild: "test",
      desktopVersion: "test",
      error: null,
      packaged: false,
      pid: 123,
      running: true,
    });
    vi.mocked(markLocalReportSynced).mockResolvedValue({ updated: 1 });
  });

  it("reuses the persisted submission identity after a failed cloud attempt", async () => {
    const submission = localSubmission("11111111-1111-4111-8111-111111111111");
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([submission]);
    vi.mocked(staffApi.post).mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ data: {} });

    await expect(syncDesktopReportSubmissions()).rejects.toThrow("response lost");
    await expect(syncDesktopReportSubmissions()).resolves.toBe(1);

    expect(vi.mocked(staffApi.post).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ submissionId: submission.submission_id }),
      expect.objectContaining({ submissionId: submission.submission_id }),
    ]);
    expect(markLocalReportSynced).toHaveBeenCalledTimes(1);
    expect(markLocalReportSynced).toHaveBeenCalledWith("http://127.0.0.1:8765", submission.report_id, submission.submission_id);
  });

  it("requires the saved submission and recognizes a background upload already confirmed", async () => {
    const submission = localSubmission("22222222-2222-4222-8222-222222222222");
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([{ ...submission, sync_status: "synced" }]);

    await expect(syncDesktopReportSubmission(submission.report_id, "older-submission")).resolves.toBe(false);
    await expect(syncDesktopReportSubmission(submission.report_id, submission.submission_id)).resolves.toBe(true);
    expect(staffApi.post).not.toHaveBeenCalled();
  });

  it("shares an in-flight upload between manual submission and background sync", async () => {
    const submission = localSubmission("11111111-1111-4111-8111-111111111111");
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([submission]);
    vi.mocked(staffApi.post).mockResolvedValue({ data: {} });

    await Promise.all([syncDesktopReportSubmission(submission.report_id, submission.submission_id), syncDesktopReportSubmissions()]);

    expect(staffApi.post).toHaveBeenCalledTimes(1);
    expect(markLocalReportSynced).toHaveBeenCalledTimes(1);
  });

  it("marks a refused report and still uploads the reports after it", async () => {
    const refused = localSubmission("11111111-1111-4111-8111-111111111111");
    const next = { ...localSubmission("33333333-3333-4333-8333-333333333333"), report_id: "REP-002" };
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([refused, next]);
    vi.mocked(staffApi.post).mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({ data: {} });

    await expect(syncDesktopReportSubmissions()).resolves.toBe(1);

    expect(markLocalReportUploadRejected).toHaveBeenCalledWith("http://127.0.0.1:8765", refused.report_id, refused.submission_id);
    expect(markLocalReportSynced).toHaveBeenCalledWith("http://127.0.0.1:8765", next.report_id, next.submission_id);
  });

  it("does not upload a report the backend already refused", async () => {
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([{ ...localSubmission("11111111-1111-4111-8111-111111111111"), sync_status: "upload_rejected" }]);

    await expect(syncDesktopReportSubmissions()).resolves.toBe(0);
    expect(staffApi.post).not.toHaveBeenCalled();
  });

  it("keeps retrying after an expired sign-in or a server error", async () => {
    vi.mocked(listLocalReportSubmissions).mockResolvedValue([localSubmission("11111111-1111-4111-8111-111111111111")]);
    vi.mocked(staffApi.post).mockRejectedValueOnce(httpError(401));

    await expect(syncDesktopReportSubmissions()).rejects.toBeInstanceOf(AxiosError);
    expect(markLocalReportUploadRejected).not.toHaveBeenCalled();
    expect([400, 409, 413, 422].map((status) => isRefusedUpload(httpError(status)))).toEqual([true, true, true, true]);
    expect([401, 403, 404, 408, 429, 500, 503].map((status) => isRefusedUpload(httpError(status)))).toEqual(Array(7).fill(false));
    expect(isRefusedUpload(new Error("offline"))).toBe(false);
  });

  it("reads the backend's reason for refusing a report", () => {
    const detail = "A report for June 2026 has already been submitted. An enterprise sends one report per reporting month, and a submitted report cannot be replaced.";
    expect(refusedUploadReason(httpError(409, { detail }))).toBe(detail);
    expect(refusedUploadReason(httpError(409))).toBeNull();
    expect(refusedUploadReason(httpError(422, { detail: [{ msg: "Field required" }] }))).toBeNull();
    expect(refusedUploadReason(httpError(503, { detail: "Try again later" }))).toBeNull();
    expect(refusedUploadReason(new Error("offline"))).toBeNull();
  });
});

function httpError(status: number, data?: unknown) {
  return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", undefined, undefined, { status, data } as AxiosResponse);
}

function localSubmission(submissionId: string): LocalReportSubmissionRecord {
  return {
    report_id: "REP-001",
    submission_id: submissionId,
    period: "June 2026",
    submitted_at: "2026-07-02T08:00:00Z",
    entries: 12,
    exits: 7,
    peak_occupancy: 5,
    unique_count: 6,
    notes: null,
    payload: {
      status: "Submitted",
      demo: {
        thisProvMale: "6",
        thisProvFemale: "0",
        otherProvMale: "0",
        otherProvFemale: "0",
        foreignMale: "0",
        foreignFemale: "0",
      },
    },
    sync_status: "pending_cloud_sync",
    synced_at: null,
    camera_breakdown: [],
  };
}

describe("establishment telemetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: { getItem: () => "test-device", setItem: vi.fn() } });
    vi.mocked(getMlServiceStatus).mockResolvedValue({ baseUrl: "http://127.0.0.1:8765", running: true, desktopBuild: "test", desktopVersion: "test", error: null, packaged: false, pid: null });
    vi.mocked(getLocalMetricsSummary).mockResolvedValue({ entries: 12, exits: 7, current_occupancy: 5, unique_count: 3, unsynced_events: 0, unsubmitted_events: 0 } as Awaited<ReturnType<typeof getLocalMetricsSummary>>);
    const areaSession = {
      running: true, status: "running", error: null, camera_id: 2, camera_name: "Plaza", camera_config: null, updated_at: null,
      counts: { entry: null, exit: null, occupancy: 8, running: true, status: "running", started_at: null, error: null },
    };
    const areaHealth = { running: true, model_ready: true, processed_frame_stale_ms: 100 } as Awaited<ReturnType<typeof getMlHealth>>;
    vi.mocked(getMlSession).mockResolvedValue(areaSession);
    vi.mocked(getMlHealth).mockResolvedValue(areaHealth);
    vi.mocked(getMlCameraStates).mockResolvedValue({
      enterprise_id: "test", enterprise_occupancy: 8, active_camera_count: 1, max_configured_cameras: 16,
      cameras: [{
        enterprise_id: "test", camera_id: 2, analysis_mode: "open_space", session: areaSession, counts: areaSession.counts, health: areaHealth,
        detections: { running: true, status: "running", error: null, frame_width: null, frame_height: null, tracks: [] },
      }],
      pending_camera_ids: [],
      max_concurrent_cameras: 6,
    });
    vi.mocked(getEstablishmentLive).mockResolvedValue({
      enterprise_id: "test", occupancy: 8, partial_occupancy: 8, state: "estimated", contributions: [],
      missing_camera_ids: [], movement_available: false, identification_available: true,
    });
    vi.mocked(staffApi.post).mockResolvedValue({ data: {} });
  });

  it.each([false, true])("publishes reconciled figures and includes Open Space cameras (mixed: %s)", async (mixed) => {
    vi.mocked(listLocalCameras).mockResolvedValue([
      ...(mixed ? [{ id: 1, name: "Entrance", status: "stopped", analysisMode: "entrance_exit" }] : []),
      { id: 2, name: "Plaza", status: "running", analysisMode: "open_space" },
    ] as Awaited<ReturnType<typeof listLocalCameras>>);
    vi.mocked(getEstablishmentSummary).mockResolvedValue({
      enterprise_id: "test", entries: mixed ? 6 : 0, exits: mixed ? 2 : 0, peak_occupancy: 10, unique_count: 11,
      confirmed_unique_count: 11, qualified_observations: 12, identification_state: "available", reconciliation_state: "estimated",
      movement_state: mixed ? "available" : "unavailable", repeat_entry_count: 0, unresolved_observations: 0,
      from_at: "2026-11-11T16:00:00Z", to_at: "2026-11-12T16:00:00Z", timezone: "Asia/Manila", covered_ms: 60_000, coverage_ratio: 0.001,
      counting_basis: "sum_of_daily_establishment_unique_visitors", policy_version: 1, snapshot_version: "test", days: [],
      days_available: 1, days_requested: 1, source_breakdown: [],
    });

    const payload = await syncDesktopTelemetry();

    expect(staffApi.post).toHaveBeenCalledWith("/operational/desktop/telemetry", payload);
    expect(payload.metrics).toMatchObject({ entries: mixed ? 6 : null, exits: mixed ? 2 : null, currentOccupancy: 8, peakOccupancy: 10, uniqueCount: 11 });
    expect(payload.monitoring).toMatchObject({
      configuredCameraCount: mixed ? 2 : 1, healthyCameraCount: 1, status: mixed ? "partial" : "running",
      cameras: expect.arrayContaining([expect.objectContaining({ cameraId: 2, cameraName: "Plaza", status: "running" })]),
    });
    expect(markLocalEventsSynced).toHaveBeenCalledOnce();
  });

  it("does not touch the local ledger when the backend has no sample dataset", async () => {
    vi.mocked(staffApi.get).mockResolvedValue({ data: null });
    await expect(prepareDesktopSampleCounts()).resolves.toBe(0);
    expect(prepareLocalSampleCounts).not.toHaveBeenCalled();
  });

  it("records every pending sample month once per local day", async () => {
    const counts = (period: string, reportId: string) => ({ entries: 700, exits: 680, uniqueCount: 520, peakOccupancy: 60, period, reportId });
    vi.mocked(staffApi.get).mockResolvedValue({
      data: {
        enterpriseId: "ENT-SAMPLE",
        enterpriseName: "Sample Park",
        counts: counts("September 2026", "SAMPLE-REP-SEP"),
        pendingCounts: [counts("September 2026", "SAMPLE-REP-SEP"), counts("October 2026", "SAMPLE-REP-OCT")],
      },
    });
    vi.mocked(prepareLocalSampleCounts).mockResolvedValue({ enterprise_id: "ENT-SAMPLE", enterprise_name: "Sample Park", period: "September 2026", prepared: true, days: 30 });

    await expect(prepareDesktopSampleCounts()).resolves.toBe(60);
    expect(prepareLocalSampleCounts).toHaveBeenCalledTimes(2);
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: DESKTOP_SAMPLE_PREPARED_EVENT }));
    expect(prepareLocalSampleCounts).toHaveBeenCalledWith("http://127.0.0.1:8765", {
      enterpriseId: "ENT-SAMPLE",
      enterpriseName: "Sample Park",
      entries: 700,
      exits: 680,
      uniqueCount: 520,
      period: "October 2026",
      reportId: "SAMPLE-REP-OCT",
    });

    await expect(prepareDesktopSampleCounts()).resolves.toBe(0);
    expect(prepareLocalSampleCounts).toHaveBeenCalledTimes(2);
  });

  it("refreshes the current month on every call so today keeps up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T04:00:00Z"));
    try {
      const current = { entries: 700, exits: 680, uniqueCount: 520, peakOccupancy: 60, period: "November 2026", reportId: "SAMPLE-REP-NOV" };
      vi.mocked(staffApi.get).mockResolvedValue({ data: { enterpriseId: "ENT-NOW", enterpriseName: "Now Park", counts: current, pendingCounts: [current] } });
      vi.mocked(prepareLocalSampleCounts).mockResolvedValue({ enterprise_id: "ENT-NOW", enterprise_name: "Now Park", period: "November 2026", prepared: true, days: 1 });

      await prepareDesktopSampleCounts();
      await prepareDesktopSampleCounts();
      expect(prepareLocalSampleCounts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
