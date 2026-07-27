import { useCallback, useEffect, useState } from "react";
import { DotFormModal } from "../../reports/components/DotFormModal";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardMetricsGrid } from "./DashboardMetricsGrid";
import { DemographicsBreakdownChart } from "./DemographicsBreakdownChart";
import { HistoricalTrendChart } from "./HistoricalTrendChart";
import { SubmissionLedgerPreview } from "./SubmissionLedgerPreview";
import type { TrendFilter } from "../types/dashboard";
import { EMPTY_LOCAL_METRICS_HISTORY } from "../../../lib/operationalDefaults";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalMetricsHistory, getLocalMetricsSummary, getMlServiceStatus, listLocalReportSubmissions } from "../../camera/services/ml-service";
import type { LocalMetricsHistory, LocalMetricsSummary } from "../../camera/services/ml-service";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { emptyDemo, hasDemographics, metricsFromReport, reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";

type DotPreviewState = {
  demo: DemoBreakdown;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
};

export function DashboardView({ enterpriseName }: { enterpriseName: string }) {
  const [trendFilter, setTrendFilter] = useState<TrendFilter>("Week");
  const [summary, setSummary] = useState<LocalMetricsSummary | null>(null);
  const [history, setHistory] = useState<LocalMetricsHistory>(EMPTY_LOCAL_METRICS_HISTORY);
  const [ledgerReports, setLedgerReports] = useState<ReportRecord[]>([]);
  const [previewReport, setPreviewReport] = useState<DotPreviewState | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  usePersistentIssue({
    id: "dashboard-visitor-counts",
    message: metricsError,
    title: "Visitor counts unavailable",
    tone: "error",
  });
  usePersistentIssue({
    id: "dashboard-report-previews",
    message: ledgerError,
    title: "Report previews unavailable",
    tone: "warning",
  });

  const refreshDashboardMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      const [nextSummary, nextHistory] = await Promise.all([getLocalMetricsSummary(baseUrl, { includeSubmitted: true }), getLocalMetricsHistory(baseUrl, { includeSubmitted: true })]);

      setSummary(nextSummary);
      setHistory(nextHistory);
      setMetricsError(status.error);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to load local edge metrics.");
    }
  }, []);

  const refreshDashboardReports = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      const submissions = await listLocalReportSubmissions(baseUrl);
      setLedgerReports(sortReportsBySubmittedAt(submissions.map(reportFromLocalSubmission)));
      setLedgerError(null);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "Unable to load submitted report previews.");
    }
  }, []);

  useEffect(() => {
    void refreshDashboardMetrics();
    const intervalId = window.setInterval(() => void refreshDashboardMetrics(), 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshDashboardMetrics]);

  useEffect(() => {
    void refreshDashboardReports();
    const intervalId = window.setInterval(() => void refreshDashboardReports(), 15000);
    return () => window.clearInterval(intervalId);
  }, [refreshDashboardReports]);

  const demographicsReport = ledgerReports.find(hasDemographics) ?? ledgerReports[0] ?? null;

  const handlePreviewReport = (report: ReportRecord) => {
    setPreviewReport({
      demo: report.demo ?? emptyDemo(),
      metrics: metricsFromReport(report),
      notes: report.notes ?? "",
      period: report.period ?? report.date,
      reportId: report.id,
    });
  };

  return (
    <div className="animate-in fade-in space-y-6 font-['Inter'] duration-500">
      {previewReport && (
        <DotFormModal
          demo={previewReport.demo}
          enterpriseName={enterpriseName}
          metrics={previewReport.metrics}
          notes={previewReport.notes}
          period={previewReport.period}
          reportId={previewReport.reportId}
          validationMessage={getDemographicAllocationStatus(previewReport.demo, previewReport.metrics.unique).validationMessage}
          onClose={() => setPreviewReport(null)}
        />
      )}

      <DashboardHeader summary={summary} />
      <DashboardMetricsGrid summary={summary} />
      <HistoricalTrendChart data={history.historical[trendFilter]} summary={summary} trendFilter={trendFilter} onTrendFilterChange={setTrendFilter} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SubmissionLedgerPreview reports={ledgerReports} onPreviewReport={handlePreviewReport} />
        <DemographicsBreakdownChart report={demographicsReport} />
      </div>
    </div>
  );
}
