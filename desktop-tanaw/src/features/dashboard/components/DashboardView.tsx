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
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsHistory,
  getLocalMetricsSummary,
  getMlCameraStates,
  getMlServiceStatus,
  getOpenSpaceMetrics,
  listLocalReportSubmissions,
} from "../../camera/services/ml-service";
import type { LocalMetricsHistory, LocalMetricsSummary, MlCameraStates } from "../../camera/services/ml-service";
import type { AreaLive, AreaMetrics } from "../../open-space/types";
import type { Camera } from "../../../types/enterprise";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { emptyDemo, hasDemographics, metricsFromReport, reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import { combineLiveOccupancy } from "../utils/combinedOccupancy";

type DotPreviewState = {
  demo: DemoBreakdown;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
};

export function DashboardView({ enterpriseName, cameras = [] }: { enterpriseName: string; cameras?: Camera[] }) {
  const user = useAuthStore((state) => state.user);
  const sourceKey = createPageStateKey({ portal: "desktop", role: "enterprise", userId: user?.id ?? "anonymous" }, "dashboard", "history-source");
  const [source, setSource] = useState(() => readPageState(sourceKey, 1, (value): value is string => typeof value === "string") ?? "entrance_exit");
  const openCameras = cameras.filter((camera) => camera.analysisMode === "open_space");
  const hasEntrance = cameras.some((camera) => camera.analysisMode !== "open_space");
  const selectedArea = openCameras.find((camera) => `camera:${camera.id}` === source) ?? (!hasEntrance ? openCameras[0] : undefined);
  const selectedSource = selectedArea ? `camera:${selectedArea.id}` : "entrance_exit";
  const areaId = selectedArea?.id;
  const openCameraIds = openCameras.map((camera) => camera.id).join(",");
  const [trendFilter, setTrendFilter] = useState<TrendFilter>("Week");
  const [summary, setSummary] = useState<LocalMetricsSummary | null>(null);
  const [history, setHistory] = useState<LocalMetricsHistory>(EMPTY_LOCAL_METRICS_HISTORY);
  const [ledgerReports, setLedgerReports] = useState<ReportRecord[]>([]);
  const [previewReport, setPreviewReport] = useState<DotPreviewState | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [areaData, setAreaData] = useState<{ cameraId: number; period: TrendFilter; metrics: AreaMetrics; live: AreaLive | null } | null>(null);
  const selectedAreaData = areaData?.cameraId === areaId && areaData?.period === trendFilter ? areaData : null;
  const areaMetrics = selectedAreaData?.metrics ?? null;
  const areaLive = selectedAreaData?.live ?? null;
  const [areaError, setAreaError] = useState<string | null>(null);
  const [areaStates, setAreaStates] = useState<MlCameraStates | null>(null);
  const combinedOccupancy =
    openCameras.length > 0
      ? combineLiveOccupancy(
          hasEntrance ? (metricsError ? null : (summary?.current_occupancy ?? null)) : 0,
          openCameras.map((camera) => areaStates?.cameras.find((state) => state.camera_id === camera.id)?.area),
        )
      : undefined;

  usePersistentIssue({
    id: "dashboard-visitor-counts",
    message: openCameras.length > 0 ? (areaError ?? (hasEntrance ? metricsError : null)) : metricsError,
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
    if (!hasEntrance && openCameraIds) return;
    void refreshDashboardMetrics();
    const intervalId = window.setInterval(() => void refreshDashboardMetrics(), 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshDashboardMetrics, hasEntrance, openCameraIds]);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    setAreaData(null);
    setAreaError(null);
    if (!openCameraIds) return;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await getMlServiceStatus();
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        const [nextMetrics, states] = await Promise.all([
          areaId === undefined ? Promise.resolve(null) : getOpenSpaceMetrics(baseUrl, areaId, trendFilter === "Today" ? 1 : trendFilter === "Week" ? 7 : 30, "", 0),
          getMlCameraStates(baseUrl),
        ]);
        if (!disposed) {
          setAreaStates(states);
          if (areaId !== undefined && nextMetrics)
            setAreaData({ cameraId: areaId, period: trendFilter, metrics: nextMetrics, live: states.cameras.find((camera) => camera.camera_id === areaId)?.area ?? null });
          setAreaError(status.error);
        }
      } catch (error) {
        if (!disposed) {
          setAreaData((current) => (current ? { ...current, live: null } : null));
          setAreaStates(null);
          setAreaError(error instanceof Error ? error.message : "Unable to load zone occupancy.");
        }
      } finally {
        busy = false;
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [areaId, trendFilter, openCameraIds]);

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

      <DashboardHeader summary={summary} description={openCameras.length > 0 ? "Live occupancy across separate, non-overlapping monitored areas." : undefined} />
      {openCameras.length > 0 && (
        <div className="space-y-2 text-sm text-gray-600 dark:text-slate-300">
          <label className="flex flex-wrap items-center gap-3 font-semibold">
            Activity history
            <select
              aria-label="Activity history source"
              value={selectedSource}
              onChange={(event) => {
                setSource(event.target.value);
                writePageState(sourceKey, 1, event.target.value);
              }}
              className="max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {(hasEntrance || cameras.length === 0) && <option value="entrance_exit">Entrance / Exit · establishment</option>}
              {openCameras.map((camera) => (
                <option key={camera.id} value={`camera:${camera.id}`}>
                  {camera.name} · {camera.openSpace?.zone_name || camera.zone}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs">
            Live Occupancy combines the Entrance / Exit balance and observed people in all separate Open Space zones. Other figures and history use the selected source. Tracking gaps are excluded;
            unavailable areas are not treated as empty.
          </p>
        </div>
      )}
      <DashboardMetricsGrid summary={summary} area={selectedArea ? { live: areaLive, metrics: areaMetrics } : undefined} combinedOccupancy={combinedOccupancy} />
      <HistoricalTrendChart
        data={history.historical[trendFilter]}
        summary={summary}
        trendFilter={trendFilter}
        unavailable={Boolean(selectedArea ? areaError : metricsError)}
        onTrendFilterChange={setTrendFilter}
        areaHistory={
          selectedArea
            ? (areaMetrics?.history ?? []).map((row) => ({
                label: new Date(row.at).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit" }),
                occupancy: row.covered_ms > 0 ? row.peak_presence : null,
              }))
            : undefined
        }
        liveOccupancy={areaLive?.available ? areaLive.presence : null}
      />
      {(hasEntrance || cameras.length === 0 || ledgerReports.length > 0) && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SubmissionLedgerPreview reports={ledgerReports} onPreviewReport={handlePreviewReport} />
          <DemographicsBreakdownChart report={demographicsReport} />
        </div>
      )}
    </div>
  );
}
