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
import type { DemoBreakdown, DemographicEvidence, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { getDemographicEvidenceStatus } from "../../reports/utils/demographics";
import { emptyDemo, hasDemographics, metricsFromReport, reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";

type DotPreviewState = {
  demo: DemoBreakdown;
  demographicEvidence: DemographicEvidence | null;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
};

export function DashboardView() {
  const [trendFilter, setTrendFilter] = useState<TrendFilter>("Week");
  const [summary, setSummary] = useState<LocalMetricsSummary | null>(null);
  const [history, setHistory] = useState<LocalMetricsHistory>(EMPTY_LOCAL_METRICS_HISTORY);
  const [ledgerReports, setLedgerReports] = useState<ReportRecord[]>([]);
  const [previewReport, setPreviewReport] = useState<DotPreviewState | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

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
      setLedgerError(error instanceof Error ? error.message : "Unable to load submission ledger previews.");
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
      demographicEvidence: report.demographicEvidence ?? null,
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
          demographicEvidence={previewReport.demographicEvidence}
          metrics={previewReport.metrics}
          notes={previewReport.notes}
          period={previewReport.period}
          reportId={previewReport.reportId}
          validationMessage={previewValidationMessage(previewReport.demo, previewReport.demographicEvidence)}
          onClose={() => setPreviewReport(null)}
        />
      )}

      <DashboardHeader error={metricsError} summary={summary} />
      {ledgerError && <p className="-mt-4 text-xs font-semibold text-amber-700 dark:text-amber-300">Submission ledger previews unavailable: {ledgerError}</p>}
      <DashboardMetricsGrid summary={summary} />
      <HistoricalTrendChart data={history.historical[trendFilter]} summary={summary} trendFilter={trendFilter} onTrendFilterChange={setTrendFilter} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SubmissionLedgerPreview reports={ledgerReports} onPreviewReport={handlePreviewReport} />
        <DemographicsBreakdownChart report={demographicsReport} />
      </div>
    </div>
  );
}

function previewValidationMessage(demo: DemoBreakdown, evidence: DemographicEvidence | null) {
  const status = getDemographicEvidenceStatus(demo);
  if (status.validationMessage) return status.validationMessage;
  if (status.hasAnyValue && !evidence) {
    return "The entered demographic counts have no explicit provenance or quality and cannot be exported as official facts.";
  }
  return null;
}
