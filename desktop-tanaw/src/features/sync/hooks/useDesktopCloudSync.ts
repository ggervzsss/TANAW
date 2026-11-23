import { useEffect, useRef } from "react";
import { LOCAL_DATA_CHANGED_EVENT, type LocalBackupRestoreResult, type MlCameraStates } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifySuccess } from "../../toasts/services/toast-service";
import { DESKTOP_REPORT_SYNC_EVENT, DESKTOP_SAMPLE_PREPARED_EVENT, prepareDesktopSampleCounts, syncDesktopReportSubmissions, syncDesktopTelemetry } from "../services/cloud-sync";
import { CAMERA_FRAME_STALE_AFTER_MS } from "../services/camera-monitoring";
import { DESKTOP_BACKUP_RESTORED_EVENT, captureBackupSession, createDesktopBackupRunner, type BackupSession } from "../services/local-backup";

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

export function restoredBackupMessage(result: LocalBackupRestoreResult) {
  const parts = [
    result.days ? `${result.days} day${result.days === 1 ? "" : "s"} of counts` : null,
    result.drafts ? `${result.drafts} report draft${result.drafts === 1 ? "" : "s"}` : null,
    result.submissions ? `${result.submissions} report${result.submissions === 1 ? "" : "s"} waiting to upload` : null,
    result.cameras ? `${result.cameras} camera${result.cameras === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);
  const restored = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "your local data");
  const notes = [
    result.cameras ? "A camera starts counting again once its username and password are saved on this computer." : null,
    result.custom_cameras ? "Enter the stream address of each custom RTSP camera again; only its host and port are backed up." : null,
  ].filter((note): note is string => note !== null);
  return [`Restored ${restored} from the server backup.`, ...notes].join(" ");
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

  useEffect(() => {
    if (!token || role !== "enterprise" || !contextReady) return undefined;

    let isDisposed = false;
    // Each sign-in reconciles and backs up its own establishment. Its work is pinned to
    // this session and cancelled when the effect ends (sign-out, account switch, rebind).
    const backupState: { changeTimerId: number | undefined } = { changeTimerId: undefined };
    const backupAbort = new AbortController();
    let backupSession: BackupSession | null;
    try {
      backupSession = captureBackupSession(backupAbort.signal);
    } catch {
      backupSession = null;
    }

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

    const backupRunner = backupSession
      ? createDesktopBackupRunner(backupSession, {
          onRestored: (restored) => {
            notifySuccess(restoredBackupMessage(restored), "desktop-backup-restored");
            window.dispatchEvent(new Event(DESKTOP_BACKUP_RESTORED_EVENT));
            // Open reports re-read their drafts, and restored reports upload.
            window.dispatchEvent(new Event(DESKTOP_SAMPLE_PREPARED_EVENT));
            void runReportSync();
          },
          onReconciled: () => void runSamplePreparation(),
        })
      : null;

    const runBackup = async () => {
      if (!isDisposed) await backupRunner?.run();
    };

    const runDueBackup = () => {
      if (!backupRunner) return;
      if (!backupRunner.reconciled || Date.now() - backupRunner.lastBackupAt >= BACKUP_INTERVAL_MS) void runBackup();
    };

    const scheduleBackupAfterChange = () => {
      if (backupState.changeTimerId !== undefined) window.clearTimeout(backupState.changeTimerId);
      backupState.changeTimerId = window.setTimeout(() => {
        backupState.changeTimerId = undefined;
        void runBackup();
      }, BACKUP_AFTER_CHANGE_DELAY_MS);
    };

    const runSamplePreparation = async () => {
      // Development sample counts wait until the server copy is merged or confirmed absent.
      if (syncStateRef.current.preparation || isDisposed || !backupRunner?.reconciled) return;
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
      backupAbort.abort();
      if (backupState.changeTimerId !== undefined) window.clearTimeout(backupState.changeTimerId);
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
