import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { EMPTY_METRICS } from "../../../lib/operationalDefaults";
import type { Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import type { SystemTimeFormat } from "../../../utils/date-time";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlServiceStatus,
  listLocalReportSubmissions,
} from "../../camera/services/ml-service";
import { getDesktopSamplePreparation, type BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import {
  mergeReportHistory,
  metricsFromSummary,
  reportFromCloudSubmission,
  reportFromLocalSubmission,
} from "../model/report-workspace";
import { listEnterpriseReportHistory } from "../services/report-history";
import { isSameReportingMonth } from "../utils/reporting-period";

type ReportsWorkspaceDataOptions = {
  activeReportId: string | null;
  currentReportingPeriod: SystemLogPeriod;
  setPeriod: Dispatch<SetStateAction<SystemLogPeriod>>;
  setReportsHistory: Dispatch<SetStateAction<ReportRecord[]>>;
  timeFormat: SystemTimeFormat;
};

export function useReportsWorkspaceData({
  activeReportId,
  currentReportingPeriod,
  setPeriod,
  setReportsHistory,
  timeFormat,
}: ReportsWorkspaceDataOptions) {
  const [livePeriod, setLivePeriod] = useState<SystemLogPeriod>(currentReportingPeriod);
  const [liveMetrics, setLiveMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [pendingPeriodCounts, setPendingPeriodCounts] = useState<BackendSamplePreparationCounts[]>([]);

  usePersistentIssue({ id: "reports-local-metrics", message: metricsError, title: "Local metrics unavailable", tone: "error" });
  usePersistentIssue({ id: "reports-submissions", message: ledgerError, title: "Report submissions unavailable", tone: "warning" });

  const refreshLocalMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const summary = await getLocalMetricsSummary(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      const summaryPeriod = summary.period || currentReportingPeriod;
      setLiveMetrics(metricsFromSummary(summary));
      setLivePeriod(summaryPeriod);
      if (!activeReportId) {
        setPeriod((currentPeriod) => (isSameReportingMonth(currentPeriod, summaryPeriod) ? summaryPeriod : currentPeriod));
      }
      setMetricsError(null);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to load local edge metrics.");
    }
  }, [activeReportId, currentReportingPeriod, setPeriod]);

  const refreshLocalReports = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const submissions = await listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
      let cloudHistory: Awaited<ReturnType<typeof listEnterpriseReportHistory>> = [];
      try {
        cloudHistory = await listEnterpriseReportHistory();
      } catch {
        // Reports saved on this device remain available while the backend is offline.
      }
      const localReports = submissions.map((submission) => reportFromLocalSubmission(submission, timeFormat));
      const cloudReports = cloudHistory.map((report) => reportFromCloudSubmission(report, timeFormat));
      setReportsHistory(mergeReportHistory(localReports, cloudReports));
      setLedgerError(null);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "Unable to load reports saved on this device.");
    }
  }, [setReportsHistory, timeFormat]);

  const refreshPendingPeriods = useCallback(async () => {
    try {
      const preparation = await getDesktopSamplePreparation();
      setPendingPeriodCounts(preparation ? (preparation.pendingCounts?.length ? preparation.pendingCounts : preparation.counts ? [preparation.counts] : []) : []);
    } catch {
      setPendingPeriodCounts([]);
    }
  }, []);

  useEffect(() => {
    void refreshLocalMetrics();
    const intervalId = window.setInterval(() => void refreshLocalMetrics(), 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshLocalMetrics]);

  useEffect(() => {
    void refreshLocalReports();
    const intervalId = window.setInterval(() => void refreshLocalReports(), 15000);
    return () => window.clearInterval(intervalId);
  }, [refreshLocalReports]);

  useEffect(() => {
    void refreshPendingPeriods();
    const intervalId = window.setInterval(() => void refreshPendingPeriods(), 15000);
    return () => window.clearInterval(intervalId);
  }, [refreshPendingPeriods]);

  return {
    liveMetrics,
    livePeriod,
    metricsError,
    pendingPeriodCounts,
    refreshLocalMetrics,
    refreshLocalReports,
    refreshPendingPeriods,
    setLiveMetrics,
    setLivePeriod,
    setMetricsError,
    setPendingPeriodCounts,
  };
}
