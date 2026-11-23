import { useEffect, useRef } from "react";
import { LOCAL_DATA_CHANGED_EVENT, type LocalBackupRestoreResult, type MlCameraStates } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifySuccess } from "../../toasts/services/toast-service";
import { DESKTOP_REPORT_SYNC_EVENT, DESKTOP_SAMPLE_PREPARED_EVENT, prepareDesktopSampleCounts, syncDesktopReportSubmissions, syncDesktopTelemetry } from "../services/cloud-sync";
import { CAMERA_FRAME_STALE_AFTER_MS } from "../services/camera-monitoring";
import { DESKTOP_BACKUP_RESTORED_EVENT, restoreDesktopBackupIfEmpty, uploadDesktopBackup } from "../services/local-backup";

const TELEMETRY_LIVE_MIN_INTERVAL_MS = 1_000;
const TELEMETRY_RECONCILE_INTERVAL_MS = 30_000;
const REPORT_SYNC_INTERVAL_MS = 20_000;
const SAMPLE_PREPARATION_INTERVAL_MS = 60_000;
/** The server backup is refreshed hourly; an unchanged backup is not uploaded again. */
export const BACKUP_INTERVAL_MS = 60 * 60_000;
/** A failed backup or restore check is retried this often. */
const BACKUP_CHECK_INTERVAL_MS = 60_000;
/** Camera or draft edits are backed up once they settle for this long. */
const BACKUP_AFTER_CHANGE_DELAY_MS = 30_000;

type BackupState = {
  changeTimerId: number | undefined;
  fingerprint: string | null;
  lastBackupAt: number;
  restoreChecked: boolean;
  running: boolean;
};

export function restoredBackupMessage(result: LocalBackupRestoreResult) {
  const parts = [
    result.days ? `${result.days} day${result.days === 1 ? "" : "s"} of counts` : null,
    result.drafts ? `${result.drafts} report draft${result.drafts === 1 ? "" : "s"}` : null,
    result.cameras ? `${result.cameras} camera${result.cameras === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);
  const restored = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "your local data");
  return result.cameras
    ? `Restored ${restored} from the server backup. Enter each camera's username and password to start counting again.`
    : `Restored ${restored} from the server backup.`;
}

type LiveTelemetryState = {
  lastSignature: string | null;
  lastSyncedAt: number;
  queued: boolean;
  timerId: number | undefined;
};

export function useDesktopCloudSync(contextReady: boolean) {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.user?.role);
  const syncStateRef = useRef({ preparation: false, reports: false, telemetry: false });
  const liveTelemetryRef = useRef<LiveTelemetryState>({
    lastSignature: null,
    lastSyncedAt: 0,
    queued: false,
    timerId: undefined,
  });
  const backupRef = useRef<BackupState>({ changeTimerId: undefined, fingerprint: null, lastBackupAt: 0, restoreChecked: false, running: false });

  useEffect(() => {
    if (!token || role !== "enterprise" || !contextReady) return undefined;

    let isDisposed = false;
    // Each sign-in checks for a restore and uploads a fresh backup for its own establishment.
    backupRef.current = { changeTimerId: undefined, fingerprint: null, lastBackupAt: 0, restoreChecked: false, running: false };

    const clearLiveTelemetryTimer = () => {
      if (liveTelemetryRef.current.timerId !== undefined) {
        window.clearTimeout(liveTelemetryRef.current.timerId);
        liveTelemetryRef.current.timerId = undefined;
      }
    };

    const scheduleTelemetrySync = (delayMs = 0) => {
      if (isDisposed) return;
      liveTelemetryRef.current.queued = true;
      if (liveTelemetryRef.current.timerId !== undefined) return;

      const elapsedMs = Date.now() - liveTelemetryRef.current.lastSyncedAt;
      const throttleDelayMs = Math.max(0, TELEMETRY_LIVE_MIN_INTERVAL_MS - elapsedMs);
      const nextDelayMs = Math.max(delayMs, throttleDelayMs);

      liveTelemetryRef.current.timerId = window.setTimeout(() => {
        liveTelemetryRef.current.timerId = undefined;
        if (!liveTelemetryRef.current.queued || isDisposed) return;
        void runTelemetrySync();
      }, nextDelayMs);
    };

    const runTelemetrySync = async () => {
      if (isDisposed) return;
      if (syncStateRef.current.telemetry) {
        liveTelemetryRef.current.queued = true;
        return;
      }

      syncStateRef.current.telemetry = true;
      liveTelemetryRef.current.queued = false;
      liveTelemetryRef.current.lastSyncedAt = Date.now();

      try {
        await syncDesktopTelemetry();
      } catch {
        // The desktop should continue operating offline; the next interval retries.
      } finally {
        syncStateRef.current.telemetry = false;
        if (liveTelemetryRef.current.queued && !isDisposed) {
          scheduleTelemetrySync(TELEMETRY_LIVE_MIN_INTERVAL_MS);
        }
      }
    };

    const runReportSync = async () => {
      if (syncStateRef.current.reports || isDisposed) return;
      syncStateRef.current.reports = true;
      try {
        await syncDesktopReportSubmissions();
      } catch {
        // Report submissions are stored locally first, so transient cloud errors are retryable.
      } finally {
        syncStateRef.current.reports = false;
      }
    };

    const runBackup = async () => {
      const backup = backupRef.current;
      if (backup.running || isDisposed) return;
      backup.running = true;
      try {
        // An empty computer is restored before anything can write to it or replace the server copy.
        if (!backup.restoreChecked) {
          const restored = await restoreDesktopBackupIfEmpty();
          backup.restoreChecked = true;
          if (restored && !isDisposed) {
            notifySuccess(restoredBackupMessage(restored), "desktop-backup-restored");
            window.dispatchEvent(new Event(DESKTOP_BACKUP_RESTORED_EVENT));
            // Open reports re-read their drafts.
            window.dispatchEvent(new Event(DESKTOP_SAMPLE_PREPARED_EVENT));
          }
          void runSamplePreparation();
        }
        backup.fingerprint = await uploadDesktopBackup(backup.fingerprint);
        backup.lastBackupAt = Date.now();
      } catch {
        // The desktop keeps working offline; the next check retries.
      } finally {
        backup.running = false;
      }
    };

    const runDueBackup = () => {
      const backup = backupRef.current;
      if (!backup.restoreChecked || Date.now() - backup.lastBackupAt >= BACKUP_INTERVAL_MS) void runBackup();
    };

    const scheduleBackupAfterChange = () => {
      const backup = backupRef.current;
      if (backup.changeTimerId !== undefined) window.clearTimeout(backup.changeTimerId);
      backup.changeTimerId = window.setTimeout(() => {
        backup.changeTimerId = undefined;
        void runBackup();
      }, BACKUP_AFTER_CHANGE_DELAY_MS);
    };

    const runSamplePreparation = async () => {
      // Sample counts would make an empty computer look in use, so they wait for the restore check.
      if (syncStateRef.current.preparation || isDisposed || !backupRef.current.restoreChecked) return;
      syncStateRef.current.preparation = true;
      try {
        // Development only: the backend returns nothing unless its sample dataset exists.
        await prepareDesktopSampleCounts();
      } catch {
        // Sample counts are optional; the next interval retries.
      } finally {
        syncStateRef.current.preparation = false;
      }
    };

    const handleLiveCameraStates = (states: MlCameraStates) => {
      const nextSignature = liveCameraStatesSignature(states);
      if (nextSignature === liveTelemetryRef.current.lastSignature) return;

      liveTelemetryRef.current.lastSignature = nextSignature;
      scheduleTelemetrySync();
    };

    const unsubscribeFromReportEvents = window.tanawMlService?.subscribeToReportEvents((event) => {
      if (event.type === "connected") {
        scheduleTelemetrySync();
      } else if (event.type === "camera.states") {
        handleLiveCameraStates(event.data);
      }
    });

    const runAllSync = () => {
      scheduleTelemetrySync();
      void runReportSync();
    };

    runAllSync();
    void runBackup();
    const preparationIntervalId = window.setInterval(runSamplePreparation, SAMPLE_PREPARATION_INTERVAL_MS);
    const telemetryIntervalId = window.setInterval(scheduleTelemetrySync, TELEMETRY_RECONCILE_INTERVAL_MS);
    const reportIntervalId = window.setInterval(runReportSync, REPORT_SYNC_INTERVAL_MS);
    const backupIntervalId = window.setInterval(runDueBackup, BACKUP_CHECK_INTERVAL_MS);
    window.addEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, scheduleBackupAfterChange);

    return () => {
      isDisposed = true;
      clearLiveTelemetryTimer();
      unsubscribeFromReportEvents?.();
      window.clearInterval(preparationIntervalId);
      window.clearInterval(telemetryIntervalId);
      window.clearInterval(reportIntervalId);
      window.clearInterval(backupIntervalId);
      if (backupRef.current.changeTimerId !== undefined) window.clearTimeout(backupRef.current.changeTimerId);
      window.removeEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);
      window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, scheduleBackupAfterChange);
    };
  }, [contextReady, role, token]);
}

function liveCameraStatesSignature(states: MlCameraStates) {
  return [...states.cameras]
    .sort((left, right) => left.camera_id - right.camera_id)
    .map(({ camera_id: cameraId, analysis_mode: mode, area, counts, health, session }) =>
      [
        cameraId,
        mode,
        area?.available,
        area?.presence,
        area?.unique_visitors,
        counts.entry,
        counts.exit,
        counts.occupancy,
        counts.running,
        counts.status,
        counts.error ?? "",
        session.running,
        session.status,
        session.error ?? "",
        health.running,
        health.model_ready,
        health.processed_frame_stale_ms !== null && health.processed_frame_stale_ms <= CAMERA_FRAME_STALE_AFTER_MS,
        health.estimated_unique_count,
        health.confirmed_unique_count,
        health.degraded_unique_count,
      ].join("|"),
    )
    .concat(`pending:${[...states.pending_camera_ids].sort((left, right) => left - right).join(",")}`)
    .join(";");
}
