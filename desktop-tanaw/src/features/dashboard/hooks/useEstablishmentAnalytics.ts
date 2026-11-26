import { useEffect, useState } from "react";
import type { Camera } from "../../../types/enterprise";
import {
  getEstablishmentHourly,
  getEstablishmentLive,
  getEstablishmentSummary,
  getMlServiceStatus,
  DEFAULT_ML_SERVICE_BASE_URL,
  type EstablishmentHourly,
  type EstablishmentLive,
  type EstablishmentSummary,
} from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import type { DashboardRange } from "../types/dashboard";
import { isSingleDay, rangeBounds } from "../utils/dashboard-range";

type Snapshot = { key: string; summary: EstablishmentSummary; live: EstablishmentLive; hourly: EstablishmentHourly | null; updatedAt: number };

/** Live and period counts from the local service. `enabled` is false while sample data is showing. */
export function useEstablishmentAnalytics(cameras: Camera[], range: DashboardRange, enabled = true) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const bounds = rangeBounds(range);
  const single = isSingleDay(range);
  const key = JSON.stringify([enterpriseId, bounds, single, cameras.map((camera) => [camera.id, camera.analysisMode])]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePersistentIssue({ id: "dashboard-visitor-counts", message: error, title: "Establishment counts unavailable", tone: "error" });

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let busy = false;
    const [expectedEnterprise, selectedRange, oneDay] = JSON.parse(key) as [string | undefined, { start: string; end: string }, boolean];
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [summary, live, hourly] = await Promise.all([
          getEstablishmentSummary(baseUrl, selectedRange),
          getEstablishmentLive(baseUrl),
          // Two-hour periods are only drawn for a single day; the chart falls back to an empty state without them.
          oneDay ? getEstablishmentHourly(baseUrl, selectedRange).catch(() => null) : Promise.resolve(null),
        ]);
        if (expectedEnterprise && (summary.enterprise_id !== expectedEnterprise || live.enterprise_id !== expectedEnterprise)) {
          throw new Error("Camera data belongs to a different establishment. Reconnect the local service.");
        }
        if (!disposed) {
          setSnapshot({ key, summary, live, hourly, updatedAt: Date.now() });
          setError(null);
        }
      } catch (issue) {
        if (!disposed) {
          setSnapshot(null);
          setError(issue instanceof Error ? issue.message : "Unable to load establishment counts.");
        }
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [key, enabled]);

  const current = snapshot?.key === key ? snapshot : null;
  return {
    summary: current?.summary ?? null,
    live: current?.live ?? null,
    hourly: current?.hourly ?? null,
    updatedAt: current?.updatedAt ?? null,
    error,
    loading: !current && !error,
  };
}
