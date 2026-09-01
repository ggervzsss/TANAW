import { useEffect, useRef } from "react";
import type { MlCameraStates } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { DESKTOP_REPORT_SYNC_EVENT, prepareDesktopSampleCounts, syncDesktopReportSubmissions, syncDesktopTelemetry } from "../services/cloud-sync";
import { CAMERA_FRAME_STALE_AFTER_MS } from "../services/camera-monitoring";

const TELEMETRY_LIVE_MIN_INTERVAL_MS = 1_000;
const TELEMETRY_RECONCILE_INTERVAL_MS = 30_000;
const REPORT_SYNC_INTERVAL_MS = 20_000;

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

    const runPreparation = async () => {
      if (syncStateRef.current.preparation || isDisposed) return;
      syncStateRef.current.preparation = true;
      try {
        await prepareDesktopSampleCounts();
      } catch {
        // Preparation remains pending until the target camera session is running.
      } finally {
        syncStateRef.current.preparation = false;
      }
    };

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
        const syncedCount = await syncDesktopReportSubmissions();
        if (syncedCount > 0) {
          void runPreparation();
        }
      } catch {
        // Report submissions are stored locally first, so transient cloud errors are retryable.
      } finally {
        syncStateRef.current.reports = false;
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
      } else {
        handleLiveCameraStates(event.data);
      }
    });

    const runAllSync = () => {
      void runPreparation();
      scheduleTelemetrySync();
      void runReportSync();
    };

    runAllSync();
    const telemetryIntervalId = window.setInterval(scheduleTelemetrySync, TELEMETRY_RECONCILE_INTERVAL_MS);
    const preparationIntervalId = window.setInterval(runPreparation, TELEMETRY_RECONCILE_INTERVAL_MS);
    const reportIntervalId = window.setInterval(runReportSync, REPORT_SYNC_INTERVAL_MS);
    window.addEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);

    return () => {
      isDisposed = true;
      clearLiveTelemetryTimer();
      unsubscribeFromReportEvents?.();
      window.clearInterval(telemetryIntervalId);
      window.clearInterval(preparationIntervalId);
      window.clearInterval(reportIntervalId);
      window.removeEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);
    };
  }, [contextReady, role, token]);
}

function liveCameraStatesSignature(states: MlCameraStates) {
  return [...states.cameras]
    .sort((left, right) => left.camera_id - right.camera_id)
    .map(({ camera_id: cameraId, counts, health, session }) =>
      [
        cameraId,
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
