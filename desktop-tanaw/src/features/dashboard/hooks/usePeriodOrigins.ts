import { useEffect, useState } from "react";
import type { DailyOrigins } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalReportDraft, getMlServiceStatus, listLocalReportSubmissions } from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { originsFromPayload } from "../../reports/model/daily-origins";
import { getDemographicDraftKey } from "../../reports/model/report-workspace";
import { isSameReportingMonth } from "../../reports/utils/reporting-period";
import { rangeMonths } from "../utils/establishment";

const REFRESH_MS = 15000;

/** Visitor origins confirmed for the range's months, from submitted reports and open drafts. */
export function usePeriodOrigins(range: { start: string; end: string }) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const key = JSON.stringify([enterpriseId, range.start, range.end]);
  const [loaded, setLoaded] = useState<{ key: string; origins: DailyOrigins } | null>(null);

  useEffect(() => {
    let disposed = false;
    const [, start, end] = JSON.parse(key) as [string | undefined, string, string];
    const months = rangeMonths({ start, end });
    const refresh = async () => {
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [submissions, drafts] = await Promise.all([
          listLocalReportSubmissions(baseUrl),
          Promise.all(months.map((period) => getLocalReportDraft(baseUrl, getDemographicDraftKey(null, period)).catch(() => null))),
        ]);
        const submitted = submissions.filter((item) => months.some((period) => isSameReportingMonth(item.period, period))).map((item) => originsFromPayload(item.payload.origins));
        // An open draft holds the latest entries; a submitted month has none.
        const origins = Object.assign({}, ...submitted, ...drafts.map((draft) => (draft ? originsFromPayload(draft.payload.origins) : undefined))) as DailyOrigins;
        if (!disposed) setLoaded({ key, origins });
      } catch {
        // Origins only refine the breakdown; without them every visitor stays in This City.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [key]);

  return loaded?.key === key ? loaded.origins : {};
}
