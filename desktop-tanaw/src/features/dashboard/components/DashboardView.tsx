import { createPageStateKey, readPageState, writePageState } from "../../../utils/page-state";
import { useAuthStore } from "../../login/stores/auth-store";
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
import { OpenSpaceDashboard } from "../../open-space/OpenSpaceDashboard";
import type { Camera } from "../../../types/enterprise";
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

export function DashboardView({ enterpriseName, cameras = [] }: { enterpriseName: string; cameras?: Camera[] }) {
  const user = useAuthStore(state => state.user);
  const modeKey = createPageStateKey({portal:"desktop",role:"enterprise",userId:user?.id ?? "anonymous"},"dashboard","analysis-mode");
  const [mode, setMode] = useState<"entrance_exit"|"open_space">(() => readPageState(modeKey,1,(v):v is "entrance_exit"|"open_space"=>v==="entrance_exit"||v==="open_space") ?? "entrance_exit");
  useEffect(() => { writePageState(modeKey,1,mode); },[mode,modeKey]);
  const openCameras=cameras.filter(c=>c.analysisMode==="open_space");
  const hasEntrance=cameras.some(c=>c.analysisMode!=="open_space");
  const showOpen=openCameras.length>0 && (!hasEntrance||mode==="open_space");
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
    <div className="animate-in fade-in space-y-6 font-sans duration-500">
      {openCameras.length>0 && <div className="flex gap-3"><button onClick={()=>setMode("entrance_exit")} disabled={!hasEntrance} aria-pressed={!showOpen}>Entrance / Exit</button><button onClick={()=>setMode("open_space")} aria-pressed={showOpen}>Open Space</button></div>}
      {showOpen ? <OpenSpaceDashboard cameras={openCameras}/> : <>
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
      <HistoricalTrendChart data={history.historical[trendFilter]} summary={summary} trendFilter={trendFilter} unavailable={Boolean(metricsError)} onTrendFilterChange={setTrendFilter} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SubmissionLedgerPreview reports={ledgerReports} onPreviewReport={handlePreviewReport} />
        <DemographicsBreakdownChart report={demographicsReport} />
      </div>
      </>}
    </div>
  );
}
