import { useEffect, useRef } from "react";
import { useAuthStore } from "../../login/stores/auth-store";
import { DESKTOP_REPORT_SYNC_EVENT, prepareDesktopMockCounts, syncDesktopReportSubmissions, syncDesktopTelemetry } from "../services/cloud-sync";
import { syncFleetSimulationTelemetry } from "../services/fleet-simulation";

const TELEMETRY_SYNC_INTERVAL_MS = 5_000;
const REPORT_SYNC_INTERVAL_MS = 20_000;

export function useDesktopCloudSync(contextReady: boolean) {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.user?.role);
  const syncStateRef = useRef({ fleet: false, preparation: false, reports: false, telemetry: false });

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

    const runTelemetrySync = async () => {
      if (syncStateRef.current.telemetry || isDisposed) return;
      syncStateRef.current.telemetry = true;
      try {
        await syncDesktopTelemetry();
      } catch {
        // The desktop should continue operating offline; the next interval retries.
      } finally {
        syncStateRef.current.telemetry = false;
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

    const runAllSync = () => {
      void runPreparation();
      void runTelemetrySync();
      void runFleetSimulationSync();
      void runReportSync();
    };

    runAllSync();
    const telemetryIntervalId = window.setInterval(runTelemetrySync, TELEMETRY_SYNC_INTERVAL_MS);
    const fleetSimulationIntervalId = window.setInterval(runFleetSimulationSync, TELEMETRY_SYNC_INTERVAL_MS);
    const preparationIntervalId = window.setInterval(runPreparation, TELEMETRY_SYNC_INTERVAL_MS);
    const reportIntervalId = window.setInterval(runReportSync, REPORT_SYNC_INTERVAL_MS);
    window.addEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);

    return () => {
      isDisposed = true;
      window.clearInterval(telemetryIntervalId);
      window.clearInterval(fleetSimulationIntervalId);
      window.clearInterval(preparationIntervalId);
      window.clearInterval(reportIntervalId);
      window.removeEventListener(DESKTOP_REPORT_SYNC_EVENT, runReportSync);
    };
  }, [contextReady, role, token]);
}
