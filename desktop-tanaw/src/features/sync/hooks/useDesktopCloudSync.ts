import { useEffect, useRef } from "react";
import {
  getMlCameraWebSocketUrl,
  type MlCameraLiveEnvelope,
  type MlCameraLiveState,
} from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { DESKTOP_REPORT_SYNC_EVENT, prepareDesktopMockCounts, syncDesktopReportSubmissions, syncDesktopTelemetry } from "../services/cloud-sync";
import { syncFleetSimulationTelemetry } from "../services/fleet-simulation";

const TELEMETRY_LIVE_MIN_INTERVAL_MS = 1_000;
const TELEMETRY_RECONCILE_INTERVAL_MS = 30_000;
const REPORT_SYNC_INTERVAL_MS = 20_000;
const LIVE_RECONNECT_MAX_DELAY_MS = 10_000;

type LiveTelemetryState = {
  lastSignature: string | null;
  lastSyncedAt: number;
  queued: boolean;
  timerId: number | undefined;
};

export function useDesktopCloudSync(contextReady: boolean, mlBaseUrl: string) {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.user?.role);
  const syncStateRef = useRef({ fleet: false, preparation: false, reports: false, telemetry: false });
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
        await prepareDesktopMockCounts();
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

    const runFleetSimulationSync = async () => {
      if (syncStateRef.current.fleet || isDisposed) return;
      syncStateRef.current.fleet = true;
      try {
        await syncFleetSimulationTelemetry();
      } catch {
        // Fleet simulation telemetry is synthetic and retryable on the next cycle.
      } finally {
        syncStateRef.current.fleet = false;
      }
    };

    const handleLiveCameraState = (state: MlCameraLiveState) => {
      const nextSignature = liveCameraStateSignature(state);
      if (nextSignature === liveTelemetryRef.current.lastSignature) return;

      liveTelemetryRef.current.lastSignature = nextSignature;
      scheduleTelemetrySync();
    };

    let liveSocket: WebSocket | null = null;
    let liveReconnectTimer: number | undefined;
    let liveReconnectAttempt = 0;

    const scheduleLiveReconnect = () => {
      if (isDisposed) return;
      const delay = Math.min(1000 * 2 ** liveReconnectAttempt, LIVE_RECONNECT_MAX_DELAY_MS);
      liveReconnectAttempt += 1;
      liveReconnectTimer = window.setTimeout(connectLiveSocket, delay);
    };

    const connectLiveSocket = () => {
      if (liveSocket) {
        liveSocket.onclose = null;
        liveSocket.onerror = null;
        liveSocket.close();
      }

      try {
        liveSocket = new WebSocket(getMlCameraWebSocketUrl(mlBaseUrl));
      } catch {
        scheduleLiveReconnect();
        return;
      }

      liveSocket.onopen = () => {
        liveReconnectAttempt = 0;
        scheduleTelemetrySync();
      };

      liveSocket.onmessage = (event) => {
        if (typeof event.data !== "string") return;

        const envelope = parseLiveCameraEnvelope(event.data);
        if (envelope?.type !== "camera.state") return;

        handleLiveCameraState(envelope.data);
      };

      liveSocket.onerror = () => {
        liveSocket?.close();
      };

      liveSocket.onclose = () => {
        scheduleLiveReconnect();
      };
    };

    const runAllSync = () => {
      void runPreparation();
      scheduleTelemetrySync();
      void runFleetSimulationSync();
      void runReportSync();
    };

    runAllSync();
    connectLiveSocket();
    const telemetryIntervalId = window.setInterval(scheduleTelemetrySync, TELEMETRY_RECONCILE_INTERVAL_MS);
    const fleetSimulationIntervalId = window.setInterval(runFleetSimulationSync, TELEMETRY_RECONCILE_INTERVAL_MS);
    const preparationIntervalId = window.setInterval(runPreparation, TELEMETRY_RECONCILE_INTERVAL_MS);
    const reportIntervalId = window.setInterval(runReportSync, REPORT_SYNC_INTERVAL_MS);
    window.addEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);

    return () => {
      isDisposed = true;
      clearLiveTelemetryTimer();
      if (liveReconnectTimer !== undefined) window.clearTimeout(liveReconnectTimer);
      if (liveSocket) {
        liveSocket.onclose = null;
        liveSocket.onerror = null;
        liveSocket.close();
      }
      window.clearInterval(telemetryIntervalId);
      window.clearInterval(fleetSimulationIntervalId);
      window.clearInterval(preparationIntervalId);
      window.clearInterval(reportIntervalId);
      window.removeEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);
    };
  }, [contextReady, mlBaseUrl, role, token]);
}

function parseLiveCameraEnvelope(rawData: string): MlCameraLiveEnvelope | null {
  try {
    return JSON.parse(rawData) as MlCameraLiveEnvelope;
  } catch {
    return null;
  }
}

function liveCameraStateSignature(state: MlCameraLiveState) {
  const { counts, health, session } = state;
  return [
    counts.entry,
    counts.exit,
    counts.occupancy,
    counts.running,
    counts.status,
    counts.error ?? "",
    session.camera_id ?? "",
    session.running,
    session.status,
    session.error ?? "",
    health.estimated_unique_count,
    health.confirmed_unique_count,
    health.degraded_unique_count,
  ].join("|");
}
