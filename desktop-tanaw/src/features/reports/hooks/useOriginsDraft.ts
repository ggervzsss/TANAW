import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DailyOrigins, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalReportDraft, getMlServiceStatus } from "../../camera/services/ml-service";
import { originsFromPayload } from "../model/daily-origins";
import { clearLegacyBrowserDemographicDrafts, persistOriginsDraft } from "../services/report-workspace";

const DRAFT_RETRY_DELAY_MS = 2000;
const DRAFT_SAVE_DELAY_MS = 300;

type OriginsDraftOptions = {
  activeReportId: string | null;
  draftKey: string;
  isReadOnly: boolean;
  period: SystemLogPeriod;
  reportsHistory: ReportRecord[];
};

/** The visitor origins entered for each day, saved as a local draft while the report is editable. */
export function useOriginsDraft({ activeReportId, draftKey, isReadOnly, period, reportsHistory }: OriginsDraftOptions): {
  origins: DailyOrigins;
  setOrigins: Dispatch<SetStateAction<DailyOrigins>>;
  isHydrating: boolean;
} {
  const [origins, setOrigins] = useState<DailyOrigins>({});
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const reportsHistoryRef = useRef(reportsHistory);

  useEffect(() => {
    reportsHistoryRef.current = reportsHistory;
  }, [reportsHistory]);

  useEffect(() => {
    clearLegacyBrowserDemographicDrafts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimeoutId: number | null = null;
    setHydratedKey(null);

    const hydrateDraft = async () => {
      let stored: DailyOrigins | undefined;
      if (!isReadOnly) {
        try {
          const status = await getMlServiceStatus();
          const draft = await getLocalReportDraft(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, draftKey);
          stored = draft ? originsFromPayload(draft.payload.origins) : undefined;
        } catch {
          if (!cancelled) retryTimeoutId = window.setTimeout(() => void hydrateDraft(), DRAFT_RETRY_DELAY_MS);
          return;
        }
      }
      if (cancelled) return;
      const report = activeReportId ? reportsHistoryRef.current.find((item) => item.id === activeReportId) : undefined;
      setOrigins(stored ?? report?.origins ?? {});
      setHydratedKey(draftKey);
    };

    void hydrateDraft();
    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    };
  }, [activeReportId, draftKey, isReadOnly]);

  useEffect(() => {
    if (isReadOnly || hydratedKey !== draftKey) return;
    const timeoutId = window.setTimeout(() => void persistOriginsDraft(draftKey, period, activeReportId, origins), DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeReportId, origins, draftKey, hydratedKey, isReadOnly, period]);

  return { origins, setOrigins, isHydrating: !isReadOnly && hydratedKey !== draftKey };
}
