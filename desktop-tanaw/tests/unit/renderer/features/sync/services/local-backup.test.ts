import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiDesktopBackup } from "../../../../../../src/contracts/api";
import { staffApi } from "../../../../../../src/lib/axios";
import { exportLocalBackup, getMlServiceStatus, restoreLocalBackup, type LocalBackup } from "../../../../../../src/features/camera/services/ml-service";
import { useAuthStore } from "../../../../../../src/features/login/stores/auth-store";
import { backupFingerprint, restoreDesktopBackupIfEmpty, toBackupUpload, toRestoreRequest, uploadDesktopBackup } from "../../../../../../src/features/sync/services/local-backup";
import { restoredBackupMessage } from "../../../../../../src/features/sync/hooks/useDesktopCloudSync";

vi.mock("../../../../../../src/lib/axios", () => ({
  staffApi: { get: vi.fn(), put: vi.fn() },
}));

vi.mock("../../../../../../src/features/camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "http://127.0.0.1:8765",
  LOCAL_DATA_CHANGED_EVENT: "tanaw:local-data-changed",
  exportLocalBackup: vi.fn(),
  getMlServiceStatus: vi.fn(),
  restoreLocalBackup: vi.fn(),
}));

vi.mock("../../../../../../src/features/sync/services/cloud-sync", () => ({
  DESKTOP_REPORT_SYNC_EVENT: "tanaw:desktop-report-submitted",
  DESKTOP_SAMPLE_PREPARED_EVENT: "tanaw:desktop-sample-prepared",
  getDesktopDeviceId: () => "desktop-1",
}));

const ENTERPRISE_ID = "park@example.test";
const CAPTURED_AT = new Date("2026-11-16T04:00:00.000Z");

function localBackup(overrides: Partial<LocalBackup> = {}): LocalBackup {
  return {
    enterprise_id: ENTERPRISE_ID,
    empty: false,
    days: [{ business_date: "2026-11-16", finalized: false, metrics: { entries: 12, unique_count: 9 } }],
    drafts: [{ draft_key: "period:November 2026", period: "November 2026", report_id: null, payload: { origins: {} }, updated_at: "2026-11-16T03:00:00.000Z" }],
    cameras: [{ id: 1, name: "Main entrance", rtsp: "rtsp://192.168.1.21/stream2" }],
    ...overrides,
  };
}

function serverBackup(): ApiDesktopBackup {
  return { ...toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT), receivedAt: "2026-11-16T04:00:01.000Z" };
}

describe("desktop local backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { enterpriseId: ENTERPRISE_ID } as never });
    vi.mocked(getMlServiceStatus).mockResolvedValue({ baseUrl: "http://127.0.0.1:8765", desktopBuild: "test", desktopVersion: "test", error: null, packaged: false, pid: 1, running: true });
  });

  it("maps local data to the server backup and back without changes", () => {
    const upload = toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT);

    expect(upload).toMatchObject({
      schemaVersion: 1,
      deviceId: "desktop-1",
      capturedAt: "2026-11-16T04:00:00.000Z",
      days: [{ businessDate: "2026-11-16", finalized: false, metrics: { entries: 12, unique_count: 9 } }],
      drafts: [{ draftKey: "period:November 2026", period: "November 2026", reportId: null }],
    });
    const local = localBackup();
    expect(toRestoreRequest(serverBackup(), ENTERPRISE_ID)).toEqual({ enterprise_id: ENTERPRISE_ID, days: local.days, drafts: local.drafts, cameras: local.cameras });
  });

  it("fingerprints only the backed-up content, in any key order", () => {
    const first = toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT);
    const later = toBackupUpload(localBackup({ cameras: [{ rtsp: "rtsp://192.168.1.21/stream2", name: "Main entrance", id: 1 }] }), "desktop-2", new Date());

    expect(backupFingerprint(later)).toBe(backupFingerprint(first));
    expect(backupFingerprint(toBackupUpload(localBackup({ days: [] }), "desktop-1", CAPTURED_AT))).not.toBe(backupFingerprint(first));
  });

  it("uploads changed data once and skips unchanged data", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup());

    const fingerprint = await uploadDesktopBackup(null, CAPTURED_AT);
    const repeated = await uploadDesktopBackup(fingerprint, new Date("2026-11-16T05:00:00.000Z"));

    expect(repeated).toBe(fingerprint);
    expect(staffApi.put).toHaveBeenCalledTimes(1);
    expect(staffApi.put).toHaveBeenCalledWith("/operational/desktop/backup", toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT));
  });

  it("never replaces the server copy from an empty computer or another establishment", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ empty: true, days: [], drafts: [], cameras: [] }));
    await expect(uploadDesktopBackup("previous")).resolves.toBe("previous");

    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ enterprise_id: "other@example.test" }));
    await expect(uploadDesktopBackup(null)).rejects.toThrow(/different establishment/);
    expect(staffApi.put).not.toHaveBeenCalled();
  });

  it("restores the server backup only into an empty computer", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ empty: true, days: [], drafts: [], cameras: [] }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup() } as AxiosResponse);
    vi.mocked(restoreLocalBackup).mockResolvedValue({ restored: true, days: 1, drafts: 1, cameras: 1 });

    await expect(restoreDesktopBackupIfEmpty()).resolves.toEqual({ restored: true, days: 1, drafts: 1, cameras: 1 });
    expect(restoreLocalBackup).toHaveBeenCalledWith("http://127.0.0.1:8765", toRestoreRequest(serverBackup(), ENTERPRISE_ID));

    vi.mocked(restoreLocalBackup).mockClear();
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup());
    await expect(restoreDesktopBackupIfEmpty()).resolves.toBeNull();
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("does nothing when the server has no backup", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ empty: true, days: [], drafts: [], cameras: [] }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: null } as AxiosResponse);

    await expect(restoreDesktopBackupIfEmpty()).resolves.toBeNull();

    vi.mocked(staffApi.get).mockRejectedValue(new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse));
    await expect(restoreDesktopBackupIfEmpty()).resolves.toBeNull();

    vi.mocked(staffApi.get).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    await expect(restoreDesktopBackupIfEmpty()).rejects.toThrow(/Network Error/);
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("tells the user what came back and that cameras need their sign-in again", () => {
    expect(restoredBackupMessage({ restored: true, days: 16, drafts: 1, cameras: 2 })).toBe(
      "Restored 16 days of counts, 1 report draft and 2 cameras from the server backup. Enter each camera's username and password to start counting again.",
    );
    expect(restoredBackupMessage({ restored: true, days: 1, drafts: 0, cameras: 0 })).toBe("Restored 1 day of counts from the server backup.");
  });
});
