import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiDesktopBackup } from "../../../../../../src/contracts/api";
import { staffApi } from "../../../../../../src/lib/axios";
import { exportLocalBackup, getMlServiceStatus, recordLocalBackupRevision, restoreLocalBackup, type LocalBackup } from "../../../../../../src/features/camera/services/ml-service";
import { useAuthStore } from "../../../../../../src/features/login/stores/auth-store";
import {
  BackupSessionChangedError,
  backupFingerprint,
  captureBackupSession,
  createDesktopBackupRunner,
  reconcileDesktopBackup,
  toBackupUpload,
  toRestoreRequest,
  uploadDesktopBackup,
  type BackupSession,
} from "../../../../../../src/features/sync/services/local-backup";
import { restoredBackupMessage } from "../../../../../../src/features/sync/hooks/useDesktopCloudSync";

vi.mock("../../../../../../src/lib/axios", () => ({
  staffApi: { get: vi.fn(), put: vi.fn() },
}));

vi.mock("../../../../../../src/features/camera/services/ml-service", () => ({
  DEFAULT_ML_SERVICE_BASE_URL: "http://127.0.0.1:8765",
  LOCAL_DATA_CHANGED_EVENT: "tanaw:local-data-changed",
  exportLocalBackup: vi.fn(),
  getMlServiceStatus: vi.fn(),
  recordLocalBackupRevision: vi.fn(),
  restoreLocalBackup: vi.fn(),
}));

vi.mock("../../../../../../src/features/sync/services/cloud-sync", () => ({
  DESKTOP_REPORT_SYNC_EVENT: "tanaw:desktop-report-submitted",
  DESKTOP_SAMPLE_PREPARED_EVENT: "tanaw:desktop-sample-prepared",
  getDesktopDeviceId: (enterpriseId: string) => `desktop-for-${enterpriseId}`,
}));

const ENTERPRISE_ID = "park@example.test";
const OTHER_ENTERPRISE_ID = "museum@example.test";
const BASE_URL = "http://127.0.0.1:8765";
const CAPTURED_AT = new Date("2026-11-16T04:00:00.000Z");
const RESTORED = { restored: true, days: 1, drafts: 1, submissions: 1, cameras: 1, custom_cameras: 0 };

function signIn(token: string, enterpriseId: string) {
  useAuthStore.setState({ token, user: { enterpriseId, role: "enterprise" } as never });
}

function localBackup(overrides: Partial<LocalBackup> = {}): LocalBackup {
  return {
    enterprise_id: ENTERPRISE_ID,
    state: { reconciled: true, server_revision: 3 },
    days: [{ business_date: "2026-11-16", finalized: false, metrics: { entries: 12, unique_count: 9 } }],
    drafts: [{ draft_key: "period:November 2026", period: "November 2026", report_id: null, payload: { origins: {} }, updated_at: "2026-11-16T03:00:00.000Z" }],
    submissions: [
      {
        report_id: "REP-OCT",
        submission_id: "SUB-OCT",
        period: "October 2026",
        submitted_at: "2026-11-02T03:00:00.000Z",
        entries: 120,
        exits: 108,
        peak_occupancy: 30,
        unique_count: 90,
        notes: null,
        payload: { status: "Submitted" },
        camera_breakdown: [{ camera_id: 1, camera_name: "Main entrance", entries: 120, exits: 108, peak_occupancy: 30, unique_count: 90 }],
      },
    ],
    cameras: [{ id: 1, name: "Main entrance", cameraHost: "192.168.1.21", rtsp: "rtsp://192.168.1.21/stream2", processingProfile: "auto", confidence: 0.35, config: {} }],
    ...overrides,
  };
}

function serverBackup(revision = 4, enterpriseId = ENTERPRISE_ID): ApiDesktopBackup {
  return { ...toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT), enterpriseId, revision, receivedAt: "2026-11-16T04:00:01.000Z" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function session(controller = new AbortController()): BackupSession {
  return captureBackupSession(controller.signal);
}

describe("desktop local backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signIn("token-park", ENTERPRISE_ID);
    vi.mocked(getMlServiceStatus).mockResolvedValue({ baseUrl: BASE_URL, desktopBuild: "test", desktopVersion: "test", error: null, packaged: false, pid: 1, running: true });
    vi.mocked(recordLocalBackupRevision).mockResolvedValue({ reconciled: true, server_revision: 4 });
    vi.mocked(staffApi.put).mockResolvedValue({ data: { revision: 4 } } as AxiosResponse);
  });

  it("maps local data to the server backup and back without changes", () => {
    const local = localBackup();
    const upload = toBackupUpload(local, "desktop-1", CAPTURED_AT);

    expect(upload).toMatchObject({
      schemaVersion: 1,
      deviceId: "desktop-1",
      capturedAt: "2026-11-16T04:00:00.000Z",
      baseRevision: 3,
      days: [{ businessDate: "2026-11-16", finalized: false, metrics: { entries: 12, unique_count: 9 } }],
      drafts: [{ draftKey: "period:November 2026", period: "November 2026", reportId: null }],
      submissions: [{ reportId: "REP-OCT", submissionId: "SUB-OCT", cameraBreakdown: [{ cameraId: 1, peakOccupancy: 30 }] }],
    });
    expect(toRestoreRequest(serverBackup(), ENTERPRISE_ID, 3)).toEqual({
      enterprise_id: ENTERPRISE_ID,
      expected_revision: 3,
      server_revision: 4,
      days: local.days,
      drafts: local.drafts,
      submissions: local.submissions,
      cameras: local.cameras,
    });
  });

  it("fingerprints the backed-up content and its base, in any key order", () => {
    const first = toBackupUpload(localBackup(), "desktop-1", CAPTURED_AT);
    const reordered = toBackupUpload(localBackup({ cameras: [{ config: {}, confidence: 0.35, processingProfile: "auto", rtsp: "rtsp://192.168.1.21/stream2", cameraHost: "192.168.1.21", name: "Main entrance", id: 1 }] }), "desktop-2", new Date());

    expect(backupFingerprint(reordered)).toBe(backupFingerprint(first));
    expect(backupFingerprint(toBackupUpload(localBackup({ days: [] }), "desktop-1", CAPTURED_AT))).not.toBe(backupFingerprint(first));
    expect(backupFingerprint(toBackupUpload(localBackup({ state: { reconciled: true, server_revision: 4 } }), "desktop-1", CAPTURED_AT))).not.toBe(backupFingerprint(first));
  });

  it("uploads changed data once with the session's own token, then records the new revision", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup());
    const pinned = session();

    const first = await uploadDesktopBackup(pinned, null, CAPTURED_AT);
    const repeated = await uploadDesktopBackup(pinned, first.fingerprint, new Date("2026-11-16T05:00:00.000Z"));

    expect(first.status).toBe("uploaded");
    expect(repeated).toEqual({ status: "unchanged", fingerprint: first.fingerprint });
    expect(staffApi.put).toHaveBeenCalledTimes(1);
    expect(staffApi.put).toHaveBeenCalledWith(
      "/operational/desktop/backup",
      toBackupUpload(localBackup(), `desktop-for-${ENTERPRISE_ID}`, CAPTURED_AT),
      expect.objectContaining({ headers: { Authorization: "Bearer token-park" }, signal: pinned.signal }),
    );
    expect(recordLocalBackupRevision).toHaveBeenCalledWith(BASE_URL, { enterprise_id: ENTERPRISE_ID, expected_revision: 3, server_revision: 4 });
  });

  it("does not upload while recovery is unresolved, even after local edits", async () => {
    // A fresh computer whose restore failed: the user saved a camera meanwhile.
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null }, days: [], drafts: [], submissions: [] }));

    await expect(uploadDesktopBackup(session(), null)).resolves.toEqual({ status: "recovery_pending", fingerprint: null });
    expect(staffApi.put).not.toHaveBeenCalled();
  });

  it("reports a conflict when the server holds a copy this computer has not merged", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: true, server_revision: null } }));
    vi.mocked(staffApi.put).mockRejectedValue(new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, { status: 409 } as AxiosResponse));

    await expect(uploadDesktopBackup(session(), "previous")).resolves.toEqual({ status: "conflict", fingerprint: "previous" });
    expect(recordLocalBackupRevision).not.toHaveBeenCalled();
  });

  it("never uploads another establishment's local data", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ enterprise_id: OTHER_ENTERPRISE_ID }));

    await expect(uploadDesktopBackup(session(), null)).rejects.toThrow(/different establishment/);
    expect(staffApi.put).not.toHaveBeenCalled();
  });

  it("cancels an upload when the account switches during the local export", async () => {
    const exported = deferred<LocalBackup>();
    vi.mocked(exportLocalBackup).mockReturnValue(exported.promise);

    const upload = uploadDesktopBackup(session(), null);
    signIn("token-museum", OTHER_ENTERPRISE_ID);
    exported.resolve(localBackup());

    await expect(upload).rejects.toBeInstanceOf(BackupSessionChangedError);
    expect(staffApi.put).not.toHaveBeenCalled();
  });

  it("does not record a revision for an upload that finished after the account switched", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup());
    const saved = deferred<AxiosResponse>();
    vi.mocked(staffApi.put).mockReturnValue(saved.promise);

    const upload = uploadDesktopBackup(session(), null);
    await vi.waitFor(() => expect(staffApi.put).toHaveBeenCalled());
    // The request already carries the first account's token, whatever is signed in now.
    expect(vi.mocked(staffApi.put).mock.calls[0][2]).toMatchObject({ headers: { Authorization: "Bearer token-park" } });
    signIn("token-museum", OTHER_ENTERPRISE_ID);
    saved.resolve({ data: { revision: 4 } } as AxiosResponse);

    await expect(upload).rejects.toBeInstanceOf(BackupSessionChangedError);
    expect(recordLocalBackupRevision).not.toHaveBeenCalled();
  });

  it("cancels work once its session ends", async () => {
    const controller = new AbortController();
    const pinned = session(controller);
    const exported = deferred<LocalBackup>();
    vi.mocked(exportLocalBackup).mockReturnValue(exported.promise);

    const upload = uploadDesktopBackup(pinned, null);
    controller.abort();
    exported.resolve(localBackup());

    await expect(upload).rejects.toBeInstanceOf(BackupSessionChangedError);
    expect(staffApi.put).not.toHaveBeenCalled();
  });

  it("merges a server revision this computer has not seen, into local data it already has", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null } }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(4) } as AxiosResponse);
    vi.mocked(restoreLocalBackup).mockResolvedValue(RESTORED);

    await expect(reconcileDesktopBackup(session())).resolves.toEqual(RESTORED);
    expect(staffApi.get).toHaveBeenCalledWith("/operational/desktop/backup", expect.objectContaining({ headers: { Authorization: "Bearer token-park" } }));
    expect(restoreLocalBackup).toHaveBeenCalledWith(BASE_URL, toRestoreRequest(serverBackup(4), ENTERPRISE_ID, null));
  });

  it("skips a revision already merged here", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: true, server_revision: 4 } }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(4) } as AxiosResponse);

    await expect(reconcileDesktopBackup(session())).resolves.toBeNull();
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("records that the server has no backup, and retries later when it cannot be reached", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null } }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: null } as AxiosResponse);

    await expect(reconcileDesktopBackup(session())).resolves.toBeNull();
    expect(recordLocalBackupRevision).toHaveBeenCalledWith(BASE_URL, { enterprise_id: ENTERPRISE_ID, expected_revision: null, server_revision: null });

    vi.mocked(recordLocalBackupRevision).mockClear();
    vi.mocked(staffApi.get).mockRejectedValue(new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse));
    await expect(reconcileDesktopBackup(session())).resolves.toBeNull();
    expect(recordLocalBackupRevision).toHaveBeenCalledOnce();

    vi.mocked(recordLocalBackupRevision).mockClear();
    vi.mocked(staffApi.get).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    await expect(reconcileDesktopBackup(session())).rejects.toThrow(/Network Error/);
    expect(recordLocalBackupRevision).not.toHaveBeenCalled();
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("cancels a restore when the account switches while the server backup downloads", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null } }));
    const downloaded = deferred<AxiosResponse>();
    vi.mocked(staffApi.get).mockReturnValue(downloaded.promise);

    const restore = reconcileDesktopBackup(session());
    await vi.waitFor(() => expect(staffApi.get).toHaveBeenCalled());
    signIn("token-museum", OTHER_ENTERPRISE_ID);
    downloaded.resolve({ data: serverBackup(4) } as AxiosResponse);

    await expect(restore).rejects.toBeInstanceOf(BackupSessionChangedError);
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("refuses a server backup that belongs to another establishment", async () => {
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null } }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(4, OTHER_ENTERPRISE_ID) } as AxiosResponse);

    await expect(reconcileDesktopBackup(session())).rejects.toThrow(/different establishment/);
    expect(restoreLocalBackup).not.toHaveBeenCalled();
  });

  it("keeps the server copy after a failed restore followed by a local edit, then merges before uploading", async () => {
    const onRestored = vi.fn();
    const onReconciled = vi.fn();
    const runner = createDesktopBackupRunner(session(), { onRestored, onReconciled });
    // A fresh computer: the restore check cannot reach the server.
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null }, days: [], drafts: [], submissions: [], cameras: [] }));
    vi.mocked(staffApi.get).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));

    await runner.run();
    expect(runner.reconciled).toBe(false);

    // The user saves a camera offline; the change triggers another backup run.
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: false, server_revision: null }, days: [], drafts: [], submissions: [] }));
    await runner.run();
    expect(staffApi.put).not.toHaveBeenCalled();

    // The server is reachable again: its copy is merged first, and only then uploaded over.
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(4) } as AxiosResponse);
    vi.mocked(restoreLocalBackup).mockImplementation(async () => {
      vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: true, server_revision: 4 } }));
      return RESTORED;
    });
    await runner.run();

    expect(restoreLocalBackup).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ expected_revision: null, server_revision: 4 }));
    expect(onRestored).toHaveBeenCalledWith(RESTORED);
    expect(onReconciled).toHaveBeenCalledOnce();
    expect(vi.mocked(staffApi.put).mock.calls[0][1]).toMatchObject({ baseRevision: 4 });
    expect(runner.reconciled).toBe(true);
  });

  it("reconciles again after another computer saved first", async () => {
    const runner = createDesktopBackupRunner(session(), { onRestored: vi.fn(), onReconciled: vi.fn() });
    vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: true, server_revision: 3 } }));
    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(3) } as AxiosResponse);
    vi.mocked(staffApi.put).mockRejectedValueOnce(new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, { status: 409 } as AxiosResponse));

    await runner.run();
    expect(runner.reconciled).toBe(false);

    vi.mocked(staffApi.get).mockResolvedValue({ data: serverBackup(5) } as AxiosResponse);
    vi.mocked(restoreLocalBackup).mockImplementation(async () => {
      vi.mocked(exportLocalBackup).mockResolvedValue(localBackup({ state: { reconciled: true, server_revision: 5 } }));
      return RESTORED;
    });
    await runner.run();

    expect(restoreLocalBackup).toHaveBeenCalledWith(BASE_URL, expect.objectContaining({ expected_revision: 3, server_revision: 5 }));
    expect(vi.mocked(staffApi.put).mock.calls.at(-1)?.[1]).toMatchObject({ baseRevision: 5 });
  });

  it("stops a runner whose account signed out", async () => {
    const runner = createDesktopBackupRunner(session(), { onRestored: vi.fn(), onReconciled: vi.fn() });
    signIn("token-museum", OTHER_ENTERPRISE_ID);

    await runner.run();

    expect(exportLocalBackup).not.toHaveBeenCalled();
  });

  it("tells the user what came back and what to enter again", () => {
    expect(restoredBackupMessage({ restored: true, days: 16, drafts: 1, submissions: 1, cameras: 2, custom_cameras: 1 })).toBe(
      "Restored 16 days of counts, 1 report draft, 1 report waiting to upload and 2 cameras from the server backup. A camera starts counting again once its username and password are saved on this computer. Enter the stream address of each custom RTSP camera again; only its host and port are backed up.",
    );
    expect(restoredBackupMessage({ restored: true, days: 1, drafts: 0, submissions: 0, cameras: 0, custom_cameras: 0 })).toBe("Restored 1 day of counts from the server backup.");
  });
});
