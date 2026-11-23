import { isAxiosError, type AxiosRequestConfig } from "axios";
import { apiPaths, type ApiDesktopBackup, type ApiDesktopBackupSummary, type ApiDesktopBackupUpload } from "../../../contracts/api";
import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  exportLocalBackup,
  getMlServiceStatus,
  recordLocalBackupRevision,
  restoreLocalBackup,
  type LocalBackup,
  type LocalBackupRestoreRequest,
  type LocalBackupRestoreResult,
} from "../../camera/services/ml-service";
import { getDesktopDeviceId } from "./cloud-sync";

/**
 * The server keeps a copy of what this computer needs to finish its reports: the
 * daily totals of months not yet delivered, the report drafts, the reports still
 * waiting to upload, and the camera settings allowed to leave this computer. A
 * reinstalled or reset desktop gets them back after sign-in.
 *
 * Every step runs for the session that started it. Its token is sent explicitly
 * and the work stops as soon as another account signs in, so a backup or restore
 * can never read one establishment's data and write it to another's.
 *
 * Until local data is reconciled with the server copy (merged, or confirmed
 * absent), nothing is uploaded: the server copy may be the only good one.
 */

/** Local data was restored from the server backup; screens showing cameras or drafts reload. */
export const DESKTOP_BACKUP_RESTORED_EVENT = "tanaw:desktop-backup-restored";

/** The session a backup or restore belongs to. */
export type BackupSession = {
  token: string;
  enterpriseId: string;
  signal: AbortSignal;
};

/** The account changed (or signed out) while a backup or restore was running. */
export class BackupSessionChangedError extends Error {
  constructor() {
    super("The signed-in account changed, so the backup step was cancelled.");
    this.name = "BackupSessionChangedError";
  }
}

export type BackupUploadResult =
  | { status: "uploaded" | "unchanged"; fingerprint: string | null }
  /** The server copy has not been merged here yet; reconcile before uploading. */
  | { status: "recovery_pending" | "conflict"; fingerprint: string | null };

/** Pins backup work to the session signed in now. */
export function captureBackupSession(signal: AbortSignal): BackupSession {
  const { token, user } = useAuthStore.getState();
  const enterpriseId = user?.enterpriseId;
  if (!token || !enterpriseId) throw new Error("Sign in with an enterprise account to back up local data.");
  return { token, enterpriseId, signal };
}

export function isBackupSessionCurrent(session: BackupSession) {
  const { token, user } = useAuthStore.getState();
  return !session.signal.aborted && token === session.token && user?.enterpriseId === session.enterpriseId;
}

function assertSessionCurrent(session: BackupSession) {
  if (!isBackupSessionCurrent(session)) throw new BackupSessionChangedError();
}

function pinned(session: BackupSession): AxiosRequestConfig {
  return { headers: { Authorization: `Bearer ${session.token}` }, signal: session.signal };
}

export function toBackupUpload(local: LocalBackup, deviceId: string, capturedAt: Date): ApiDesktopBackupUpload {
  return {
    schemaVersion: 1,
    deviceId,
    capturedAt: capturedAt.toISOString(),
    baseRevision: local.state.server_revision,
    days: local.days.map((day) => ({ businessDate: day.business_date, finalized: day.finalized, metrics: day.metrics })),
    drafts: local.drafts.map((draft) => ({
      draftKey: draft.draft_key,
      period: draft.period,
      reportId: draft.report_id,
      payload: draft.payload,
      updatedAt: draft.updated_at,
    })),
    submissions: local.submissions.map((submission) => ({
      reportId: submission.report_id,
      submissionId: submission.submission_id,
      period: submission.period,
      submittedAt: submission.submitted_at,
      entries: submission.entries,
      exits: submission.exits,
      peakOccupancy: submission.peak_occupancy,
      uniqueCount: submission.unique_count,
      notes: submission.notes,
      payload: submission.payload,
      cameraBreakdown: submission.camera_breakdown.map((total) => ({
        cameraId: total.camera_id,
        cameraName: total.camera_name,
        entries: total.entries,
        exits: total.exits,
        peakOccupancy: total.peak_occupancy,
        uniqueCount: total.unique_count,
      })),
    })),
    cameras: local.cameras as ApiDesktopBackupUpload["cameras"],
  };
}

export function toRestoreRequest(backup: ApiDesktopBackup, enterpriseId: string, expectedRevision: number | null): LocalBackupRestoreRequest {
  return {
    enterprise_id: enterpriseId,
    expected_revision: expectedRevision,
    server_revision: backup.revision,
    days: (backup.days ?? []).map((day) => ({ business_date: day.businessDate, finalized: day.finalized, metrics: day.metrics })),
    drafts: (backup.drafts ?? []).map((draft) => ({
      draft_key: draft.draftKey,
      period: draft.period,
      report_id: draft.reportId ?? null,
      payload: draft.payload,
      updated_at: draft.updatedAt,
    })),
    submissions: (backup.submissions ?? []).map((submission) => ({
      report_id: submission.reportId,
      submission_id: submission.submissionId,
      period: submission.period,
      submitted_at: submission.submittedAt,
      entries: submission.entries ?? null,
      exits: submission.exits ?? null,
      peak_occupancy: submission.peakOccupancy ?? null,
      unique_count: submission.uniqueCount ?? 0,
      notes: submission.notes ?? null,
      payload: submission.payload,
      camera_breakdown: (submission.cameraBreakdown ?? []).map((total) => ({
        camera_id: total.cameraId ?? null,
        camera_name: total.cameraName ?? null,
        entries: total.entries,
        exits: total.exits,
        peak_occupancy: total.peakOccupancy,
        unique_count: total.uniqueCount,
      })),
    })),
    cameras: (backup.cameras ?? []) as Record<string, unknown>[],
  };
}

/** Identifies a backup's contents and base, so an unchanged backup is not uploaded again. */
export function backupFingerprint(upload: ApiDesktopBackupUpload) {
  return stableStringify({ base: upload.baseRevision, days: upload.days, drafts: upload.drafts, submissions: upload.submissions, cameras: upload.cameras });
}

function hasBackupContent(upload: ApiDesktopBackupUpload) {
  return Boolean(upload.days?.length || upload.drafts?.length || upload.submissions?.length || upload.cameras?.length);
}

function restoredSomething(result: LocalBackupRestoreResult) {
  return result.restored && result.days + result.drafts + result.submissions + result.cameras > 0;
}

async function localServiceBaseUrl() {
  const status = await getMlServiceStatus();
  return status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
}

/** Reads local data and checks it belongs to the session's establishment. */
async function exportForSession(session: BackupSession) {
  const baseUrl = await localServiceBaseUrl();
  const local = await exportLocalBackup(baseUrl);
  assertSessionCurrent(session);
  if (local.enterprise_id !== session.enterpriseId) throw new Error("Local data belongs to a different establishment.");
  return { baseUrl, local };
}

async function fetchServerBackup(session: BackupSession): Promise<ApiDesktopBackup | null> {
  try {
    const backup = (await staffApi.get<ApiDesktopBackup | null>(apiPaths.desktopBackup, pinned(session))).data;
    assertSessionCurrent(session);
    if (backup && backup.enterpriseId !== session.enterpriseId) throw new Error("The server backup belongs to a different establishment.");
    return backup;
  } catch (error) {
    assertSessionCurrent(session);
    // A server without backups has nothing to restore; other failures retry later.
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Reconciles local data with the server copy: merges a server revision this
 * computer has not seen yet, or records that there is none. Nothing already on
 * this computer is overwritten. Returns what was restored, or null.
 */
export async function reconcileDesktopBackup(session: BackupSession): Promise<LocalBackupRestoreResult | null> {
  const { baseUrl, local } = await exportForSession(session);
  const backup = await fetchServerBackup(session);
  const expected = local.state.server_revision;
  if (!backup) {
    if (!local.state.reconciled || expected !== null) {
      assertSessionCurrent(session);
      await recordLocalBackupRevision(baseUrl, { enterprise_id: session.enterpriseId, expected_revision: expected, server_revision: null });
    }
    return null;
  }
  if (local.state.reconciled && backup.revision === expected) return null;
  // The local service also refuses a restore for an establishment it is not bound to.
  assertSessionCurrent(session);
  const result = await restoreLocalBackup(baseUrl, toRestoreRequest(backup, session.enterpriseId, expected));
  return restoredSomething(result) ? result : null;
}

/**
 * Uploads the local backup when it changed since `lastFingerprint`. Nothing is
 * uploaded until local data is reconciled with the server copy, and the server
 * refuses an upload that was not based on the copy it holds.
 */
export async function uploadDesktopBackup(session: BackupSession, lastFingerprint: string | null, now = new Date()): Promise<BackupUploadResult> {
  const { baseUrl, local } = await exportForSession(session);
  if (!local.state.reconciled) return { status: "recovery_pending", fingerprint: lastFingerprint };

  const upload = toBackupUpload(local, getDesktopDeviceId(session.enterpriseId), now);
  const fingerprint = backupFingerprint(upload);
  if (fingerprint === lastFingerprint) return { status: "unchanged", fingerprint };
  // Nothing set up here and nothing on the server: there is nothing to keep yet.
  if (!hasBackupContent(upload) && upload.baseRevision === null) return { status: "unchanged", fingerprint: lastFingerprint };

  let summary: ApiDesktopBackupSummary;
  try {
    summary = (await staffApi.put<ApiDesktopBackupSummary>(apiPaths.desktopBackup, upload, pinned(session))).data;
  } catch (error) {
    assertSessionCurrent(session);
    if (isAxiosError(error) && error.response?.status === 409) return { status: "conflict", fingerprint: lastFingerprint };
    throw error;
  }
  assertSessionCurrent(session);
  await recordLocalBackupRevision(baseUrl, { enterprise_id: session.enterpriseId, expected_revision: upload.baseRevision ?? null, server_revision: summary.revision });
  return { status: "uploaded", fingerprint };
}

export type DesktopBackupRunner = {
  /** Reconciles first when needed, then uploads a changed backup. Never throws. */
  run: () => Promise<void>;
  readonly reconciled: boolean;
  readonly lastBackupAt: number;
};

/**
 * The backup loop for one session. Recovery comes first: nothing is uploaded until
 * local data is reconciled with the server copy, so a slow or failed restore
 * followed by local edits cannot replace the only good copy. A conflict (another
 * computer saved first) sends the next run back through reconciliation.
 */
export function createDesktopBackupRunner(session: BackupSession, { onRestored, onReconciled }: { onRestored: (result: LocalBackupRestoreResult) => void; onReconciled: () => void }): DesktopBackupRunner {
  let reconciled = false;
  let running = false;
  let fingerprint: string | null = null;
  let lastBackupAt = 0;
  return {
    get reconciled() {
      return reconciled;
    },
    get lastBackupAt() {
      return lastBackupAt;
    },
    async run() {
      if (running || !isBackupSessionCurrent(session)) return;
      running = true;
      try {
        if (!reconciled) {
          const restored = await reconcileDesktopBackup(session);
          reconciled = true;
          if (restored && isBackupSessionCurrent(session)) onRestored(restored);
          onReconciled();
        }
        const result = await uploadDesktopBackup(session, fingerprint);
        if (result.status === "conflict" || result.status === "recovery_pending") {
          reconciled = false;
          return;
        }
        fingerprint = result.fingerprint;
        lastBackupAt = Date.now();
      } catch {
        // Offline, or the account changed: the desktop keeps working and the next run retries.
      } finally {
        running = false;
      }
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
