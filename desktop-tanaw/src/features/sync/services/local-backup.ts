import { isAxiosError } from "axios";
import { apiPaths, type ApiDesktopBackup, type ApiDesktopBackupUpload } from "../../../contracts/api";
import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  exportLocalBackup,
  getMlServiceStatus,
  restoreLocalBackup,
  type LocalBackup,
  type LocalBackupRestoreRequest,
  type LocalBackupRestoreResult,
} from "../../camera/services/ml-service";
import { getDesktopDeviceId } from "./cloud-sync";

/**
 * The server keeps a copy of what this computer needs to finish its reports: the
 * daily totals of months not yet submitted, the report drafts, and the camera
 * settings without usernames or passwords. A reinstalled or reset desktop gets
 * them back after sign-in.
 */

/** Local data was restored from the server backup; screens showing cameras or drafts reload. */
export const DESKTOP_BACKUP_RESTORED_EVENT = "tanaw:desktop-backup-restored";

export function toBackupUpload(local: LocalBackup, deviceId: string, capturedAt: Date): ApiDesktopBackupUpload {
  return {
    schemaVersion: 1,
    deviceId,
    capturedAt: capturedAt.toISOString(),
    days: local.days.map((day) => ({ businessDate: day.business_date, finalized: day.finalized, metrics: day.metrics })),
    drafts: local.drafts.map((draft) => ({
      draftKey: draft.draft_key,
      period: draft.period,
      reportId: draft.report_id,
      payload: draft.payload,
      updatedAt: draft.updated_at,
    })),
    cameras: local.cameras,
  };
}

export function toRestoreRequest(backup: ApiDesktopBackup, enterpriseId: string): LocalBackupRestoreRequest {
  return {
    enterprise_id: enterpriseId,
    days: (backup.days ?? []).map((day) => ({ business_date: day.businessDate, finalized: day.finalized, metrics: day.metrics })),
    drafts: (backup.drafts ?? []).map((draft) => ({
      draft_key: draft.draftKey,
      period: draft.period,
      report_id: draft.reportId ?? null,
      payload: draft.payload,
      updated_at: draft.updatedAt,
    })),
    cameras: backup.cameras ?? [],
  };
}

/** Identifies a backup's contents, so an unchanged backup is not uploaded again. */
export function backupFingerprint(upload: ApiDesktopBackupUpload) {
  return stableStringify({ days: upload.days, drafts: upload.drafts, cameras: upload.cameras });
}

function hasBackupContent(backup: Pick<ApiDesktopBackup, "cameras" | "days" | "drafts">) {
  return Boolean(backup.days?.length || backup.drafts?.length || backup.cameras?.length);
}

async function localServiceBaseUrl() {
  const status = await getMlServiceStatus();
  return status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
}

function signedInEnterpriseId() {
  const enterpriseId = useAuthStore.getState().user?.enterpriseId;
  if (!enterpriseId) throw new Error("Sign in with an enterprise account to back up local data.");
  return enterpriseId;
}

function assertSameEnterprise(local: LocalBackup, enterpriseId: string) {
  if (local.enterprise_id !== enterpriseId) throw new Error("Local data belongs to a different establishment.");
}

/**
 * Restores the server backup when this computer has no local data yet.
 * Returns null when there was nothing to restore.
 */
export async function restoreDesktopBackupIfEmpty(): Promise<LocalBackupRestoreResult | null> {
  const enterpriseId = signedInEnterpriseId();
  const baseUrl = await localServiceBaseUrl();
  const local = await exportLocalBackup(baseUrl);
  assertSameEnterprise(local, enterpriseId);
  if (!local.empty) return null;

  let backup: ApiDesktopBackup | null;
  try {
    backup = (await staffApi.get<ApiDesktopBackup | null>(apiPaths.desktopBackup)).data;
  } catch (error) {
    // A server without backups has nothing to restore; other failures retry later.
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
  if (!backup || !hasBackupContent(backup)) return null;
  const result = await restoreLocalBackup(baseUrl, toRestoreRequest(backup, enterpriseId));
  return result.restored ? result : null;
}

/**
 * Uploads the local backup when it changed since `lastFingerprint`, and returns
 * the fingerprint now saved on the server.
 */
export async function uploadDesktopBackup(lastFingerprint: string | null, now = new Date()): Promise<string | null> {
  const enterpriseId = signedInEnterpriseId();
  const baseUrl = await localServiceBaseUrl();
  const local = await exportLocalBackup(baseUrl);
  assertSameEnterprise(local, enterpriseId);
  // An empty computer has nothing to protect, and uploading would replace the server copy.
  if (local.empty) return lastFingerprint;

  const upload = toBackupUpload(local, getDesktopDeviceId(), now);
  const fingerprint = backupFingerprint(upload);
  if (fingerprint === lastFingerprint) return lastFingerprint;
  await staffApi.put(apiPaths.desktopBackup, upload);
  return fingerprint;
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
