import { FlaskConical } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Camera, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, listLocalReportSubmissions } from "../../camera/services/ml-service";
import { DotFormModal } from "../../reports/components/DotFormModal";
import { getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { SAMPLE_DASHBOARD_SHORTCUT, isSampleDashboardShortcut, toggleSampleDashboard, updateDeveloperSettings, useDeveloperSettings } from "../../preferences/developer-settings";
import { sampleDashboard } from "../sample/sample-dashboard";
import { countingFromPayload } from "../../reports/model/report-workspace";
import { useEstablishmentAnalytics } from "../hooks/useEstablishmentAnalytics";
import { useUsualBaseline } from "../hooks/useUsualBaseline";
import { useCameraStatusTimes } from "../hooks/useCameraStatusTimes";
import { joinNames } from "../utils/camera-status";
import { isCameraCounting } from "../utils/establishment";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import type { TrafficPoint } from "../types/dashboard";
import { useAssistantStore } from "../stores/assistant-store";
import type { DashboardRange } from "../types/dashboard";
import { assistantFilter, businessDate, dayStartMs, isSingleDay, presetRange, rangeLength, rangePhrase, weekdayName } from "../utils/dashboard-range";
import { emptyDemo, metricsFromReport, reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";
import { BUCKET_HOURS, busiestIndex, dailyTraffic, dayChangeFromUsual, describeChange, hourlyTraffic, rangeChangeFromBefore } from "../utils/traffic";
import { DashboardHeader } from "./DashboardHeader";
import { EstablishmentMetrics } from "./EstablishmentMetrics";
import { MonitoredLocations } from "./MonitoredLocations";
import { SubmissionLedgerPreview } from "./SubmissionLedgerPreview";
import { TanawAssistant } from "./TanawAssistant";
import { VisitorTrafficChart } from "./VisitorTrafficChart";
import "../dashboard.css";

type DotPreviewState = { attractionType?: string; enterpriseId: string | null | undefined; demo: DemoBreakdown; metrics: Metrics; notes: string; period: SystemLogPeriod; reportId: string };

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
  const updatedAt = sample ? now : real.updatedAt;
  const error = sample ? null : real.error;
  const loading = sample ? false : real.loading;
  const { timeFormat } = useSystemDisplayPreferences();
  const assistantOpen = useAssistantStore((state) => state.open);
  const toggleAssistant = useAssistantStore((state) => state.toggle);
  const setAssistantAvailable = useAssistantStore((state) => state.setAvailable);
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const [ledger, setLedger] = useState<{ enterpriseId: typeof enterpriseId; reports: ReportRecord[] } | null>(null);
  const ledgerReports = ledger && ledger.enterpriseId === enterpriseId ? ledger.reports : [];
  const reports = sample?.reports ?? ledgerReports;
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const reportsLoading = !sample && ledger === null && ledgerError === null;
  const [preview, setPreview] = useState<DotPreviewState | null>(null);
  usePersistentIssue({ id: "dashboard-report-previews", message: ledgerError, title: "Report previews unavailable", tone: "warning" });

  useEffect(() => {
    setAssistantAvailable(true);
    return () => setAssistantAvailable(false);
  }, [setAssistantAvailable]);

  const refreshReports = useCallback(async () => {
    const status = await getMlServiceStatus();
    const submissions = await listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
    if (
      submissions.some((item) => {
        const data = countingFromPayload(item.payload.counting);
        return data && data.enterprise_id !== enterpriseId;
      })
    )
      throw new Error("Saved reports belong to another establishment.");
    return sortReportsBySubmittedAt(submissions.map(reportFromLocalSubmission));
  }, [enterpriseId]);

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

  const isToday = single && range.from === today;
  const elapsedHours = isToday ? (now - dayStartMs(today)) / 3_600_000 : null;
  const points = useMemo(() => {
    if (!single) return dailyTraffic(summary, usualDays, range, rangeLength(range) > 8);
    const periods = hourlyTraffic(hourly, usualHours, timeFormat);
    // Today, periods that have not started yet are shown as what usually comes, not as gaps.
    return elapsedHours === null ? periods : periods.map((point) => ({ ...point, later: Number(point.key.slice(1)) > elapsedHours }));
  }, [single, hourly, usualHours, timeFormat, summary, usualDays, range, elapsedHours]);
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
  // Cameras not counting now, and since when today, for the captions that say what totals leave out.
  const stopped = live ? cameras.filter((camera) => !isCameraCounting(camera.id, live)) : [];
  const stoppedNames = joinNames(stopped.map((camera) => camera.name));
  const outageTimes = stopped.map((camera) => marks[String(camera.id)]).filter((mark) => mark && !mark.counting).map((mark) => mark.since);
  const outageSince = outageTimes.length ? Math.max(todayStart, Math.min(...outageTimes)) : null;
  const affectsRange = stopped.length > 0 && range.to === today;
  const cameraWord = stopped.length > 1 ? "cameras" : "camera";
  const outageNote = affectsRange ? `${stoppedNames} not counted${outageSince !== null ? ` since ${timeOf(outageSince)}` : ""}` : null;
  const footnote = !affectsRange
    ? null
    : outageSince !== null
      ? `Counts after ${timeOf(outageSince)} today leave out the ${stoppedNames} ${cameraWord}.`
      : `Counts leave out the ${stoppedNames} ${cameraWord}.`;
  const partialNote = (point: TrafficPoint) => {
    if (!affectsRange) return null;
    if (!single) return point.key === today ? `Leaves out the ${stoppedNames}` : null;
    if (!isToday) return null;
    const periodEnd = todayStart + (Number(point.key.slice(1)) + BUCKET_HOURS) * 3_600_000;
    return outageSince === null || periodEnd > outageSince ? `Leaves out the ${stoppedNames}` : null;
  };
  const updatedLabel = updatedAt === null || now - updatedAt < 60_000 ? "a few seconds ago" : timeOf(updatedAt);

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
            validationMessage={getDemographicAllocationStatus(preview.demo, preview.metrics.unique).validationMessage}
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
            points={points}
            change={{ text: changeText, percent: changePercent }}
            range={range}
            today={today}
            loading={loading}
            outageNote={outageNote}
            updatedLabel={updatedLabel}
          />
        </div>
        <div className="dash-split">
          <VisitorTrafficChart
            points={points}
            busiest={busiest}
            summary={chartSummary}
            inProgressKey={inProgressKey}
            partialNote={partialNote}
            footnote={footnote}
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
            setPreview({ enterpriseId, attractionType: report.attractionType, demo: report.demo ?? emptyDemo(), metrics: metricsFromReport(report), notes: report.notes ?? "", period: report.period ?? report.date, reportId: report.id })
          }
        />
      </div>
      <TanawAssistant open={assistantOpen} onToggle={toggleAssistant} report={reports[0] ?? null} filter={assistantFilter(range)} />
    </div>
  );
}
