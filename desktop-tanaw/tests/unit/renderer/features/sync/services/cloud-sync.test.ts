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
  type LocalReportSubmissionRecord,
} from "../../../../../../src/features/camera/services/ml-service";
import { syncDesktopTelemetry, prepareDesktopSampleCounts, syncDesktopReportSubmission, syncDesktopReportSubmissions } from "../../../../../../src/features/sync/services/cloud-sync";

vi.mock("../../../../../../src/lib/axios", () => ({
  staffApi: {
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

  it("uses a new persisted identity for a genuine report revision", async () => {
    let current = localSubmission("11111111-1111-4111-8111-111111111111");
    vi.mocked(listLocalReportSubmissions).mockImplementation(async () => [current]);
    vi.mocked(staffApi.post).mockResolvedValue({ data: {} });

    await syncDesktopReportSubmission(current.report_id);
    current = localSubmission("22222222-2222-4222-8222-222222222222", "Resubmitted");
    await syncDesktopReportSubmission(current.report_id);

    expect(vi.mocked(staffApi.post).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ submissionId: "11111111-1111-4111-8111-111111111111" }),
      expect.objectContaining({ submissionId: "22222222-2222-4222-8222-222222222222" }),
    ]);
  });
});

function localSubmission(submissionId: string, status: "Submitted" | "Resubmitted" = "Submitted"): LocalReportSubmissionRecord {
  return {
    report_id: "REP-001",
    submission_id: submissionId,
    period: "June 2026",
    submitted_at: status === "Submitted" ? "2026-07-02T08:00:00Z" : "2026-07-03T08:00:00Z",
    entries: 12,
    exits: 7,
    peak_occupancy: 5,
    unique_count: 6,
    notes: null,
    payload: {
      status,
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
    vi.stubGlobal("window", { localStorage: { getItem: () => "test-device", setItem: vi.fn() } });
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
      missing_camera_ids: [], excluded_camera_ids: [], movement_available: false, identification_available: true,
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

  it("does not prepare synthetic doorway samples for Open Space cameras", async () => {
    vi.mocked(listLocalCameras).mockResolvedValue([{ id: 1, analysisMode: "open_space" }] as Awaited<ReturnType<typeof listLocalCameras>>);
    await expect(prepareDesktopSampleCounts()).resolves.toBeNull();
    expect(staffApi.post).not.toHaveBeenCalled();
    expect(getLocalMetricsSummary).not.toHaveBeenCalled();
  });
});
