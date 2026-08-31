import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffApi } from "../../../lib/axios";
import {
  getMlServiceStatus,
  listLocalReportSubmissions,
  markLocalReportSynced,
  type LocalReportSubmissionRecord,
} from "../../camera/services/ml-service";
import { syncDesktopReportSubmission, syncDesktopReportSubmissions } from "./cloud-sync";

vi.mock("../../../lib/axios", () => ({
  staffApi: {
    post: vi.fn(),
  },
}));

vi.mock("../../camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "http://127.0.0.1:8765",
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

vi.mock("../../reports/services/report-history", () => ({
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
    vi.mocked(staffApi.post)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ data: {} });

    await expect(syncDesktopReportSubmissions()).rejects.toThrow("response lost");
    await expect(syncDesktopReportSubmissions()).resolves.toBe(1);

    expect(vi.mocked(staffApi.post).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ submissionId: submission.submission_id }),
      expect.objectContaining({ submissionId: submission.submission_id }),
    ]);
    expect(markLocalReportSynced).toHaveBeenCalledTimes(1);
    expect(markLocalReportSynced).toHaveBeenCalledWith(
      "http://127.0.0.1:8765",
      submission.report_id,
      submission.submission_id,
    );
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

function localSubmission(
  submissionId: string,
  status: "Submitted" | "Resubmitted" = "Submitted",
): LocalReportSubmissionRecord {
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
