import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DemoBreakdown, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalReportDraft, getMlServiceStatus } from "../../camera/services/ml-service";
import { demoFromPayload, emptyDemo } from "../model/report-workspace";
import { clearLegacyBrowserDemographicDrafts, persistDemographicDraft } from "../services/report-workspace";

const DRAFT_RETRY_DELAY_MS = 2000;
const DRAFT_SAVE_DELAY_MS = 300;

type DemographicDraftOptions = {
  activeReportId: string | null;
  demographicDraftKey: string;
  isReadOnly: boolean;
  period: SystemLogPeriod;
  reportsHistory: ReportRecord[];
};

export function useDemographicDraft({
  activeReportId,
  demographicDraftKey,
  isReadOnly,
  period,
  reportsHistory,
}: DemographicDraftOptions): { demo: DemoBreakdown; setDemo: Dispatch<SetStateAction<DemoBreakdown>> } {
  const [demo, setDemo] = useState<DemoBreakdown>(emptyDemo);
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
      let storedDemo: DemoBreakdown | null = null;
      if (!isReadOnly) {
        try {
          const status = await getMlServiceStatus();
          const draft = await getLocalReportDraft(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, demographicDraftKey);
          storedDemo = draft ? demoFromPayload(draft.payload.demo) : null;
        } catch {
          if (!cancelled) retryTimeoutId = window.setTimeout(() => void hydrateDraft(), DRAFT_RETRY_DELAY_MS);
          return;
        }
      }
      if (cancelled) return;
      if (storedDemo) setDemo(storedDemo);
      else if (activeReportId) setDemo(reportsHistoryRef.current.find((item) => item.id === activeReportId)?.demo ?? emptyDemo());
      else setDemo(emptyDemo());
      setHydratedKey(demographicDraftKey);
    };

    void hydrateDraft();
    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    };
  }, [activeReportId, demographicDraftKey, isReadOnly]);

  useEffect(() => {
    if (isReadOnly || hydratedKey !== demographicDraftKey) return;
    const timeoutId = window.setTimeout(() => void persistDemographicDraft(demographicDraftKey, period, activeReportId, demo), DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeReportId, demo, demographicDraftKey, hydratedKey, isReadOnly, period]);

  return { demo, setDemo };
}
