import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DailyOrigins, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalReportDraft, getMlServiceStatus } from "../../camera/services/ml-service";
import { DESKTOP_SAMPLE_PREPARED_EVENT } from "../../sync/services/cloud-sync";
import { mergeMissingOriginDays, originsFromPayload } from "../model/daily-origins";
import { correctionSource } from "../model/report-lifecycle";
import { clearLegacyBrowserDemographicDrafts, persistOriginsDraft } from "../services/report-workspace";
import { notifyWarning } from "../../toasts/services/toast-service";

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
  // The origins as loaded; saving them back unchanged could delete a draft written meanwhile.
  const hydratedOrigins = useRef<DailyOrigins | null>(null);
  const failedDraftKey = useRef<string | null>(null);

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
      // A month being fixed starts from the origins of the refused report.
      const report = activeReportId ? reportsHistoryRef.current.find((item) => item.id === activeReportId) : correctionSource(reportsHistoryRef.current, period);
      const loadedOrigins = stored ?? report?.origins ?? {};
      hydratedOrigins.current = loadedOrigins;
      setOrigins(loadedOrigins);
      setHydratedKey(draftKey);
    };

    void hydrateDraft();
    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
    };
  }, [activeReportId, draftKey, isReadOnly, period]);

  // Sample preparation confirms origins in the local draft, possibly after this report loaded.
  // Days it added are merged in; days already here keep what is shown.
  useEffect(() => {
    if (isReadOnly || hydratedKey !== draftKey) return;
    let cancelled = false;
    const mergeStoredDays = async () => {
      try {
        const status = await getMlServiceStatus();
        const draft = await getLocalReportDraft(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, draftKey);
        const stored = draft ? originsFromPayload(draft.payload.origins) : undefined;
        if (cancelled || !stored) return;
        setOrigins((current) => mergeMissingOriginDays(current, stored));
      } catch {
        // The next preparation run retries.
      }
    };
    const handlePrepared = () => void mergeStoredDays();
    window.addEventListener(DESKTOP_SAMPLE_PREPARED_EVENT, handlePrepared);
    return () => {
      cancelled = true;
      window.removeEventListener(DESKTOP_SAMPLE_PREPARED_EVENT, handlePrepared);
    };
  }, [draftKey, hydratedKey, isReadOnly]);

  useEffect(() => {
    if (isReadOnly || hydratedKey !== draftKey || origins === hydratedOrigins.current) return;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void persistOriginsDraft(draftKey, period, activeReportId, origins).then((saved) => {
        if (cancelled) return;
        if (saved) {
          if (failedDraftKey.current === draftKey) failedDraftKey.current = null;
        } else if (failedDraftKey.current !== draftKey) {
          failedDraftKey.current = draftKey;
          notifyWarning("The latest visitor details could not be saved. Keep this report open and try editing again.");
        }
      });
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeReportId, origins, draftKey, hydratedKey, isReadOnly, period]);

  return { origins, setOrigins, isHydrating: !isReadOnly && hydratedKey !== draftKey };
}
