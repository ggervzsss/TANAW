import { useCallback, useEffect, useState } from "react";
import { CAMERA_MODE_LABEL, cameraModeName } from "../../camera/utils/camera-mode";
import type { Camera, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, listLocalReportSubmissions } from "../../camera/services/ml-service";
import { DotFormModal } from "../../reports/components/DotFormModal";
import { getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { usePersistentIssue } from "../../toasts/services/persistent-issue";
import { useAuthStore } from "../../login/stores/auth-store";
import { countingFromPayload } from "../../reports/model/report-workspace";
import { useEstablishmentAnalytics } from "../hooks/useEstablishmentAnalytics";
import type { TrendFilter } from "../types/dashboard";
import { emptyDemo, hasDemographics, metricsFromReport, reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";
import { DashboardHeader } from "./DashboardHeader";
import { DemographicsBreakdownChart } from "./DemographicsBreakdownChart";
import { EstablishmentMetrics } from "./EstablishmentMetrics";
import { EstablishmentTrendChart } from "./EstablishmentTrendChart";
import { TanawAssistant } from "./TanawAssistant";
import { PeakActivity } from "./PeakActivity";
import { SubmissionLedgerPreview } from "./SubmissionLedgerPreview";

type DotPreviewState = { enterpriseId: string | null | undefined; demo: DemoBreakdown; metrics: Metrics; notes: string; period: SystemLogPeriod; reportId: string };

export function DashboardView({ enterpriseName, cameras = [] }: { enterpriseName: string; cameras?: Camera[] }) {
  const [filter, setFilter] = useState<TrendFilter>("Today");
  const { summary, live, range, error, loading } = useEstablishmentAnalytics(cameras, filter);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId);
  const [ledger, setLedger] = useState<{ enterpriseId: typeof enterpriseId; reports: ReportRecord[] } | null>(null);
  const reports = ledger && ledger.enterpriseId === enterpriseId ? ledger.reports : [];
  const [preview, setPreview] = useState<DotPreviewState | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  usePersistentIssue({ id: "dashboard-report-previews", message: ledgerError, title: "Report previews unavailable", tone: "warning" });

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

  const demographicsReport = reports.find(hasDemographics) ?? reports[0] ?? null;
  const offline = live?.state === "partial";
  const partial = summary?.reconciliation_state === "partial";
  return (
    <div className={`overview-layout ${assistantOpen ? "assistant-is-open" : ""}`}>
      <div className="overview-main">
        {preview && preview.enterpriseId === enterpriseId && (
          <DotFormModal
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
        <DashboardHeader filter={filter} onFilterChange={setFilter} />
        {offline && (
          <p role="status" className="mx-4.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100">
            Some cameras are offline. Totals include the cameras that are running.
          </p>
        )}
        <EstablishmentMetrics summary={summary} live={live} filter={filter} loading={loading} />
        <EstablishmentTrendChart summary={summary} range={range} filter={filter} unavailable={Boolean(error)} />
        <div className="overview-secondary">
          <DemographicsBreakdownChart report={demographicsReport} />
          <PeakActivity summary={summary} />
        </div>
        <SubmissionLedgerPreview
          enterpriseName={enterpriseName}
          reports={reports}
          onPreviewReport={(report) =>
            setPreview({ enterpriseId, demo: report.demo ?? emptyDemo(), metrics: metricsFromReport(report), notes: report.notes ?? "", period: report.period ?? report.date, reportId: report.id })
          }
        />
        <details className="overview-coverage">
          <summary>Counting coverage and estimate details</summary>
          <section aria-label="Counting coverage" className="space-y-2 border-l-2 border-emerald-700 pl-4 text-sm text-slate-600 dark:border-emerald-400 dark:text-slate-300">
            <p>Recognized people count once per establishment each day. For several days, the visitor total adds the daily estimates; a person visiting on different days can contribute again.</p>
            {partial && <p>Some visitors could not be recognized or some days have no observations. These figures are partial estimates.</p>}
            {summary && (
              <p className="text-xs">
                Observation coverage: {summary.coverage_ratio > 0 && summary.coverage_ratio < 0.01 ? "<1" : Math.round(summary.coverage_ratio * 100)}% of the selected period. Unresolved observations:{" "}
                {summary.unresolved_observations.toLocaleString()}. Live occupancy shows the current observation; other figures follow the period below.
              </p>
            )}
          </section>
        </details>
        {cameras.length > 0 && (
          <details className="rounded-xl border border-slate-200 px-5 py-4 text-sm dark:border-slate-700">
            <summary className="cursor-pointer font-semibold text-slate-900 dark:text-slate-100">Camera status</summary>
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Live occupancy adds the Entry / Exit balance of all doors and the people inside every Open Space area.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 pr-4 font-semibold">Camera</th>
                    <th className="py-2 pr-4 font-semibold">{CAMERA_MODE_LABEL}</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((camera) => {
                    const counting = live?.contributions.some((item) => item.camera_ids.includes(camera.id));
                    return (
                      <tr key={camera.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="py-3 pr-4">{camera.name}</td>
                        <td className="py-3 pr-4">{cameraModeName(camera.analysisMode)}</td>
                        <td className="py-3">{counting ? "Counting" : "Offline"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
      <TanawAssistant open={assistantOpen} onToggle={() => setAssistantOpen((value) => !value)} report={reports[0] ?? null} filter={filter} />
    </div>
  );
}
