import { useEffect, useState } from "react";
import { DEFAULT_ML_SERVICE_BASE_URL, getEstablishmentHourly, getEstablishmentSummary, getMlServiceStatus, type EstablishmentHourly, type EstablishmentSummary } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import type { DashboardRange } from "../types/dashboard";
import { addDays, isSingleDay, rangeBounds, rangeLength } from "../utils/dashboard-range";
import { USUAL_WEEKS, usualHistoryDates } from "../utils/traffic";

type Baseline = { key: string; hours: Array<EstablishmentHourly | null>; days: EstablishmentSummary | null };

/** Earlier days refresh slowly; they only change when a new day closes. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Earlier weeks that tell the dashboard what is usual. A single day loads the same weekday in each of
 * the last four weeks, hour by hour; a range loads the days before it. Missing history leaves the
 * chart without a usual line rather than failing.
 */
export function useUsualBaseline(range: DashboardRange, enabled = true) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const key = JSON.stringify([enterpriseId, range.from, range.to]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    const [expectedEnterprise, from, to] = JSON.parse(key) as [string | undefined, string, string];
    const selected = { from, to };
    const load = async () => {
      try {
        const baseUrl = (await getMlServiceStatus()).baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const belongs = (data: { enterprise_id: string } | null) => !data || !expectedEnterprise || data.enterprise_id === expectedEnterprise;
        if (isSingleDay(selected)) {
          const hours = await Promise.all(usualHistoryDates(from).map((date) => getEstablishmentHourly(baseUrl, rangeBounds({ from: date, to: date })).catch(() => null)));
          if (!disposed) setBaseline({ key, hours: hours.map((item) => (belongs(item) ? item : null)), days: null });
        } else {
          const span = Math.max(USUAL_WEEKS * 7, rangeLength(selected));
          const days = await getEstablishmentSummary(baseUrl, rangeBounds({ from: addDays(from, -span), to: addDays(from, -1) })).catch(() => null);
          if (!disposed) setBaseline({ key, hours: [], days: belongs(days) ? days : null });
        }
      } catch {
        if (!disposed) setBaseline({ key, hours: [], days: null });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [key, enabled]);

  const current = baseline?.key === key ? baseline : null;
  return { usualHours: current?.hours ?? [], usualDays: current?.days ?? null };
}
