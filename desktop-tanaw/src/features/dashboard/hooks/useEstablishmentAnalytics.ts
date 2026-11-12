import { useEffect, useState } from "react";
import type { Camera } from "../../../types/enterprise";
import { getEstablishmentLive, getEstablishmentSummary, getMlServiceStatus, DEFAULT_ML_SERVICE_BASE_URL, type EstablishmentLive, type EstablishmentSummary } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import type { TrendFilter } from "../types/dashboard";
import { establishmentRange } from "../utils/establishment";

type Snapshot = { key: string; summary: EstablishmentSummary; live: EstablishmentLive };

export function useEstablishmentAnalytics(cameras: Camera[], filter: TrendFilter) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const range = establishmentRange(filter);
  const key = JSON.stringify([enterpriseId, range, cameras.map((camera) => [camera.id, camera.analysisMode, camera.coverage])]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePersistentIssue({ id: "dashboard-visitor-counts", message: error, title: "Establishment counts unavailable", tone: "error" });

  useEffect(() => {
    let disposed = false;
    let busy = false;
    const [expectedEnterprise, selectedRange] = JSON.parse(key) as [string | undefined, { start: string; end: string }];
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [summary, live] = await Promise.all([getEstablishmentSummary(baseUrl, selectedRange), getEstablishmentLive(baseUrl)]);
        if (expectedEnterprise && (summary.enterprise_id !== expectedEnterprise || live.enterprise_id !== expectedEnterprise)) {
          throw new Error("Camera data belongs to a different establishment. Reconnect the local service.");
        }
        if (!disposed) {
          setSnapshot({ key, summary, live });
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
  }, [key]);

  const current = snapshot?.key === key ? snapshot : null;
  return { summary: current?.summary ?? null, live: current?.live ?? null, range, error, loading: !current && !error };
}
