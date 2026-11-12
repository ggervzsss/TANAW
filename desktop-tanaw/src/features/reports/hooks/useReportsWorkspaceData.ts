import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import type { SystemTimeFormat } from "../../../utils/date-time";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getEstablishmentReportPeriods,
  getEstablishmentSummary,
  getMlServiceStatus,
  listLocalReportSubmissions,
  type EstablishmentSummary,
} from "../../camera/services/ml-service";
import { useAuthStore } from "../../login/stores/auth-store";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import { countingFromPayload, mergeReportHistory, reportFromCloudSubmission, reportFromLocalSubmission, type PreparedReportCounts } from "../model/report-workspace";
import { listEnterpriseReportHistory } from "../services/report-history";
import { isSameReportingMonth, reportingMonthKey } from "../utils/reporting-period";

export function metricsFromEstablishment(summary: EstablishmentSummary): Metrics {
  return {
    entries: summary.movement_state === "unavailable" ? null : summary.entries,
    exits: summary.movement_state === "unavailable" ? null : summary.exits,
    peak: summary.peak_occupancy,
    unique: summary.unique_count,
    counting: summary,
  };
}

export function reportBaselineError(summary: EstablishmentSummary | null): string | null {
  if (!summary || summary.reconciliation_state === "not_collected") return "No observations have been collected for this reporting period.";
  if (summary.reconciliation_state === "configuration_required") return "Complete camera counting roles and coverage relationships before submitting this period.";
  if (summary.identification_state === "unavailable") return "The visitor estimate is unavailable for this reporting period.";
  return null;
}

type Options = {
  currentReportingPeriod: SystemLogPeriod;
  period: SystemLogPeriod;
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
  timeFormat: SystemTimeFormat;
};
type Packet = { enterpriseId: string | null | undefined; period: string; selected: EstablishmentSummary; current: EstablishmentSummary; periods: PreparedReportCounts[] };
const EMPTY: Metrics = { entries: null, exits: null, peak: null, unique: 0 };

export function useReportsWorkspaceData({ currentReportingPeriod, period, setReportsHistory, timeFormat }: Options) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const metricsSequence = useRef(0);
  const ledgerSequence = useRef(0);
  const current = packet && packet.enterpriseId === enterpriseId && isSameReportingMonth(packet.period, period) ? packet : null;

  usePersistentIssue({ id: "reports-local-metrics", message: requestError, title: "Establishment report metrics unavailable", tone: "error" });
  usePersistentIssue({ id: "reports-submissions", message: ledgerError, title: "Report submissions unavailable", tone: "warning" });

  const refreshLocalMetrics = useCallback(async () => {
    const sequence = ++metricsSequence.current;
    try {
      const status = await getMlServiceStatus();
      const base = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      const [selected, periods, currentSummary] = await Promise.all([
        getEstablishmentSummary(base, { period }),
        getEstablishmentReportPeriods(base),
        isSameReportingMonth(period, currentReportingPeriod) ? Promise.resolve(null) : getEstablishmentSummary(base, { period: currentReportingPeriod }),
      ]);
      if (enterpriseId && [selected, currentSummary, ...periods.map((item) => item.counting)].some((item) => item && item.enterprise_id !== enterpriseId))
        throw new Error("The report data belongs to another establishment. Reconnect the local service.");
      if (sequence !== metricsSequence.current || useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      setPacket({
        enterpriseId,
        period,
        selected,
        current: currentSummary ?? selected,
        periods: periods.map((item) => ({
          period: item.period,
          reportId: `PENDING-${reportingMonthKey(item.period)}`,
          entries: item.metrics.entries,
          exits: item.metrics.exits,
          peakOccupancy: item.metrics.peak_occupancy,
          uniqueCount: item.metrics.unique_count,
          counting: item.counting,
        })),
      });
      setRequestError(null);
    } catch (error) {
      if (sequence === metricsSequence.current && useAuthStore.getState().user?.enterpriseId === enterpriseId) {
        setRequestError(error instanceof Error ? error.message : "Unable to load establishment summaries.");
        setPacket(null);
      }
    }
  }, [enterpriseId, period, currentReportingPeriod]);

  const refreshLocalReports = useCallback(async () => {
    const sequence = ++ledgerSequence.current;
    try {
      const status = await getMlServiceStatus();
      const submissions = await listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      if (
        enterpriseId &&
        submissions.some((item) => {
          const snapshot = countingFromPayload(item.payload.counting);
          return snapshot && snapshot.enterprise_id !== enterpriseId;
        })
      )
        throw new Error("Saved report data belongs to another establishment.");
      let cloud: Awaited<ReturnType<typeof listEnterpriseReportHistory>> = [];
      try {
        cloud = await listEnterpriseReportHistory();
      } catch {
        /* Local snapshots remain available offline. */
      }
      if (sequence !== ledgerSequence.current || useAuthStore.getState().user?.enterpriseId !== enterpriseId) return;
      setReportsHistory(
        mergeReportHistory(
          submissions.map((item) => reportFromLocalSubmission(item, timeFormat)),
          cloud.filter((item) => !enterpriseId || item.enterpriseId === enterpriseId).map((item) => reportFromCloudSubmission(item, timeFormat)),
        ),
      );
      setLedgerError(null);
    } catch (error) {
      if (sequence === ledgerSequence.current && useAuthStore.getState().user?.enterpriseId === enterpriseId) setLedgerError(error instanceof Error ? error.message : "Unable to load saved reports.");
    }
  }, [enterpriseId, setReportsHistory, timeFormat]);

  useEffect(() => {
    void refreshLocalMetrics();
    const timer = window.setInterval(() => void refreshLocalMetrics(), 5000);
    return () => {
      window.clearInterval(timer);
      metricsSequence.current += 1;
    };
  }, [refreshLocalMetrics]);
  useEffect(() => {
    void refreshLocalReports();
    const timer = window.setInterval(() => void refreshLocalReports(), 15000);
    return () => {
      window.clearInterval(timer);
      ledgerSequence.current += 1;
    };
  }, [refreshLocalReports]);

  return {
    liveMetrics: current ? metricsFromEstablishment(current.selected) : EMPTY,
    currentMetrics: current ? metricsFromEstablishment(current.current) : EMPTY,
    counting: current?.selected ?? null,
    pendingPeriodCounts: current?.periods ?? [],
    metricsError: requestError ?? (current ? reportBaselineError(current.selected) : "Loading establishment summaries…"),
    loading: !current && !requestError,
    refreshLocalMetrics,
    refreshLocalReports,
  };
}
