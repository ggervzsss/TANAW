import { FlaskConical } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Camera, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { useNavigate } from "react-router-dom";
import { routePaths } from "../../../app/router/routePaths";
import { DotFormModal } from "../../reports/components/DotFormModal";
import { ReportDraftActions } from "../../reports/components/ReportDraftActions";
import { isSubmittedStatus, reportingStatus } from "../../reports/model/report-status";
import { sentReportBlocker } from "../../reports/model/report-preview";
import { getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { SAMPLE_DASHBOARD_SHORTCUT, isSampleDashboardShortcut, toggleSampleDashboard, updateDeveloperSettings, useDeveloperSettings } from "../../preferences/developer-settings";
import { sampleDashboard } from "../sample/sample-dashboard";
import { useEstablishmentAnalytics } from "../hooks/useEstablishmentAnalytics";
import { useUsualBaseline } from "../hooks/useUsualBaseline";
import { useCameraStatusTimes } from "../hooks/useCameraStatusTimes";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import { useAssistantStore } from "../stores/assistant-store";
import type { DashboardRange } from "../types/dashboard";
import { assistantFilter, businessDate, dayStartMs, isSingleDay, presetRange, rangeLength, rangePhrase, weekdayName } from "../utils/dashboard-range";
import { emptyDemo, metricsFromReport } from "../utils/reportLedger";
import { loadLocalReportLedger } from "../services/report-ledger";
import { BUCKET_HOURS, busiestIndex, dailyTraffic, dayChangeFromUsual, describeChange, hourlyTraffic, rangeChangeFromBefore, todaySoFar } from "../utils/traffic";
import { DashboardHeader } from "./DashboardHeader";
import { EstablishmentMetrics } from "./EstablishmentMetrics";
import { MonitoredLocations } from "./MonitoredLocations";
import { SubmissionLedgerPreview } from "./SubmissionLedgerPreview";
import { VisitorTrafficChart } from "./VisitorTrafficChart";
import "../dashboard.css";

type DotPreviewState = {
  attractionType?: string;
  enterpriseId: string | null | undefined;
  demo: DemoBreakdown;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  reportId: string;
  /** Submit Form, with what blocks it, until TANAW holds the report; then null (Print and Download PDF). */
  submit: { blocker: string | null } | null;
};

/** The clock, refreshed each minute so "today" and the period in progress stay current. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function DashboardView({ enterpriseName, cameras: liveCameras = [] }: { enterpriseName: string; cameras?: Camera[] }) {
  const now = useMinuteClock();
  const today = businessDate(new Date(now));
  const [chosen, setChosen] = useState<DashboardRange>(() => presetRange("today", today));
  // Quick ranges follow the calendar; a range picked by hand stays as chosen.
  const range = useMemo(() => (chosen.preset === "custom" ? chosen : presetRange(chosen.preset, today)), [chosen, today]);
  const single = isSingleDay(range);
  const showSample = useDeveloperSettings().sampleDashboard;
  // The sample data switch from Settings > Developer, also on a shortcut while the Dashboard is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || !isSampleDashboardShortcut(event)) return;
      event.preventDefault();
      toggleSampleDashboard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const real = useEstablishmentAnalytics(liveCameras, range, !showSample);
  const realUsual = useUsualBaseline(range, !showSample);
  const elapsedToday = (now - dayStartMs(today)) / 3_600_000;
  // Settings > Developer can fill the dashboard with made-up counts to preview the layout.
  const sample = useMemo(() => (showSample ? sampleDashboard(range, today, elapsedToday) : null), [showSample, range, today, elapsedToday]);
  const cameras = sample?.cameras ?? liveCameras;
  const live = sample ? sample.live : real.live;
  const summary = sample ? sample.summary : real.summary;
  const hourly = sample ? sample.hourly : real.hourly;
  const usualHours = sample ? sample.usualHours : realUsual.usualHours;
  const usualDays = sample ? sample.usualDays : realUsual.usualDays;
  const error = sample ? null : real.error;
  const loading = sample ? false : real.loading;
  const { timeFormat } = useSystemDisplayPreferences();
  const setAssistantDashboard = useAssistantStore((state) => state.setDashboard);
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const [ledger, setLedger] = useState<{ enterpriseId: typeof enterpriseId; reports: ReportRecord[] } | null>(null);
  const ledgerReports = ledger && ledger.enterpriseId === enterpriseId ? ledger.reports : [];
  const reports = sample?.reports ?? ledgerReports;
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const reportsLoading = !sample && ledger === null && ledgerError === null;
  const [preview, setPreview] = useState<DotPreviewState | null>(null);
  const navigate = useNavigate();
  usePersistentIssue({ id: "dashboard-report-previews", message: ledgerError, title: "Report previews unavailable", tone: "warning" });

  const refreshReports = useCallback(() => loadLocalReportLedger(enterpriseId), [enterpriseId]);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await refreshReports();
        if (!disposed) {
          setLedger({ enterpriseId, reports: next });
          setLedgerError(null);
        }
      } catch (issue) {
        if (!disposed) setLedgerError(issue instanceof Error ? issue.message : "Unable to load submitted reports.");
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [refreshReports, enterpriseId]);

  // TANAW Insights lives in the shell; on the dashboard its answers follow this range and the latest report shown here.
  const assistantPeriod = assistantFilter(range);
  const latestReport = reports[0] ?? null;
  useEffect(() => setAssistantDashboard({ filter: assistantPeriod, report: latestReport }), [setAssistantDashboard, assistantPeriod, latestReport]);
  useEffect(() => () => setAssistantDashboard(null), [setAssistantDashboard]);

  const isToday = single && range.from === today;
  const elapsedHours = isToday ? (now - dayStartMs(today)) / 3_600_000 : null;
  const liveOccupancy = live?.occupancy ?? null;
  const points = useMemo(() => {
    if (!single) return dailyTraffic(summary, usualDays, range, rangeLength(range) > 8);
    if (elapsedHours === null) return hourlyTraffic(hourly, usualHours, timeFormat);
    // Today is live: the chart runs to the period under way and never into hours still to come.
    return todaySoFar(hourlyTraffic(hourly, usualHours, timeFormat, Math.floor(elapsedHours)), elapsedHours, liveOccupancy);
  }, [single, hourly, usualHours, timeFormat, summary, usualDays, range, elapsedHours, liveOccupancy]);
  const busiest = busiestIndex(points);
  const changePercent = single ? dayChangeFromUsual(points, elapsedHours) : rangeChangeFromBefore(summary, usualDays, range, today);
  const changeText = describeChange(changePercent, single ? `a usual ${weekdayName(range.from)}` : `the ${rangeLength(range)} days before`);
  const entriesShown = summary && summary.movement_state !== "unavailable";
  const chartSummary = entriesShown ? `${summary.entries.toLocaleString("en-US")} entries ${rangePhrase(range, today)}${changeText ? `, ${changeText.charAt(0).toLowerCase()}${changeText.slice(1)}` : ""}.` : null;
  const inProgressKey = isToday && elapsedHours !== null ? `h${Math.floor(elapsedHours / BUCKET_HOURS) * BUCKET_HOURS}` : null;
  const marks = useCameraStatusTimes(cameras, live, sample?.marks);
  const todayStart = dayStartMs(today);
  const timeOf = (at: number) => formatPhilippineDateTime(at, timeFormat, { timeStyle: "short" });
  const formatSince = (at: number) => (at >= todayStart ? timeOf(at) : formatPhilippineDateTime(at, timeFormat, { dateStyle: "medium" }));

  return (
    <div className="overview-layout dash">
      <div className="overview-main dash-main">
        {preview && preview.enterpriseId === enterpriseId && (
          <DotFormModal
            attractionType={preview.attractionType}
            demo={preview.demo}
            enterpriseName={enterpriseName}
            metrics={preview.metrics}
            notes={preview.notes}
            period={preview.period}
            reportId={preview.reportId}
            validationMessage={!preview.submit ? getDemographicAllocationStatus(preview.demo, preview.metrics.unique).validationMessage : null}
            actions={
              preview.submit && (
                <ReportDraftActions
                  label="Submit Form"
                  isReadOnly={false}
                  isPeriodChanging={false}
                  metricsError={null}
                  validationError={preview.submit.blocker}
                  onSubmitPrompt={() => navigate(routePaths.enterpriseReports)}
                />
              )
            }
            onClose={() => setPreview(null)}
          />
        )}
        <div className="dash-hero">
          <DashboardHeader
            range={range}
            today={today}
            onRangeChange={setChosen}
            notice={
              showSample && (
                <p className="dash-sample-note" role="status">
                  <FlaskConical size={15} aria-hidden="true" />
                  <span>
                    <strong>Sample data</strong> Not saved or reported. {SAMPLE_DASHBOARD_SHORTCUT} turns it off.
                  </span>
                  <button type="button" aria-keyshortcuts="Control+Shift+M" onClick={() => updateDeveloperSettings({ sampleDashboard: false })}>
                    Turn off
                  </button>
                </p>
              )
            }
          />
          <EstablishmentMetrics
            key={`${range.from}:${range.to}`}
            cameras={cameras}
            summary={summary}
            live={live}
            range={range}
            today={today}
            loading={loading}
          />
        </div>
        <div className="dash-split">
          <VisitorTrafficChart
            points={points}
            busiest={busiest}
            summary={chartSummary}
            inProgressKey={inProgressKey}
            isLive={isToday}
            loading={loading}
            unavailable={Boolean(error)}
          />
          <div className="dash-side">
            <MonitoredLocations cameras={cameras} live={live} loading={loading} marks={marks} formatSince={formatSince} />
          </div>
        </div>
        <SubmissionLedgerPreview
          enterpriseName={enterpriseName}
          reports={reports}
          loading={reportsLoading}
          onPreviewReport={(report) =>
            setPreview({
              enterpriseId,
              attractionType: report.attractionType,
              demo: report.demo ?? emptyDemo(),
              metrics: metricsFromReport(report),
              notes: report.notes ?? "",
              period: report.period ?? report.date,
              reportId: report.id,
              // Print and Download PDF wait until TANAW holds the report.
              submit: isSubmittedStatus(reportingStatus("history", report)) ? null : { blocker: sentReportBlocker(report) },
            })
          }
        />
      </div>
    </div>
  );
}
