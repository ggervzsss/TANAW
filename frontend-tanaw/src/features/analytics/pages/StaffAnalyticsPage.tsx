import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ClipboardCheck, Users } from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { EmptyState, PageMotion, stagger } from "@/shared/components/ui";
import { useOperationalReports } from "@/shared/hooks/useOperationalSync";
import { listReportEnterprises } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import {
  getAcceptedReports,
  getAnalyticsPeriods,
  getBarangayCoverageRows,
  getCurrentAnalyticsPeriod,
  getEnterpriseReportRows,
  getTrendLabel,
  sumMetric,
  type BarangayCoverageRow,
} from "../utils/reportAnalytics";

const EMPTY_REPORT_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_INTAKE_REPORTS: IntakeReport[] = [];

export function StaffAnalyticsPage() {
  const reportsQuery = useOperationalReports();
  const reports = reportsQuery.data ?? EMPTY_INTAKE_REPORTS;
  const reportEnterprisesQuery = useQuery({ queryKey: ["report-enterprises"], queryFn: listReportEnterprises });
  const reportEnterprises = reportEnterprisesQuery.data ?? EMPTY_REPORT_ENTERPRISES;
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);

  const currentPeriod = useMemo(() => getCurrentAnalyticsPeriod(), []);
  const periods = useMemo(() => getAnalyticsPeriods(reports, currentPeriod), [currentPeriod, reports]);
  const activePeriodIndex = Math.max(
    periods.findIndex((period) => period.key === selectedPeriodKey),
    0,
  );
  const activePeriod = periods[activePeriodIndex];
  const activePeriodReports = activePeriod?.reports ?? EMPTY_INTAKE_REPORTS;
  const activeReports = useMemo(() => getAcceptedReports(activePeriodReports), [activePeriodReports]);
  const enterpriseRows = useMemo(() => getEnterpriseReportRows(reportEnterprises, activePeriodReports), [activePeriodReports, reportEnterprises]);
  const acceptedRows = enterpriseRows.filter((row) => row.accepted);
  const totalReports = reportEnterprises.length;
  const acceptanceRate = totalReports === 0 ? 0 : Math.round((acceptedRows.length / totalReports) * 100);
  const comparisonPeriod = periods[activePeriodIndex + 1];
  const chartData = enterpriseRows.map(({ enterprise, reports, accepted }) => ({
    name: enterprise.name,
    entries: sumMetric(reports, "entry"),
    unique: sumMetric(reports, "unique"),
    status: accepted ? "Accepted" : "Awaiting acceptance",
  }));
  const coverageRows = useMemo(() => getBarangayCoverageRows(enterpriseRows), [enterpriseRows]);

  return (
    <PageMotion>
      <PageHeader title="Dashboard" description="Compare enterprise performance to identify discrepancies before consolidation." />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4" variants={stagger}>
        <MetricCard
          color="#065f46"
          label="Total Aggregated Entries"
          value={sumMetric(activeReports, "entry")}
          foot={getTrendLabel(activeReports, comparisonPeriod)}
          footClassName="text-tgreen-light"
          icon={Activity}
        />
        <MetricCard color="#2563eb" label="Sum of Venue Estimates" value={sumMetric(activeReports, "unique")} foot="Not a distinct-person count" icon={Users} />
        <MetricCard
          color="#f59e0b"
          label="Accepted Report Coverage"
          value={`${acceptedRows.length} / ${totalReports}`}
          foot={`${acceptanceRate}% of current registry`}
          footClassName="text-yellow-600"
          icon={ClipboardCheck}
        />
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">Reporting Period</span>
            <p className="mt-1 text-[11px] leading-snug text-gray-500">Filter comparative data and live update history by calendar month.</p>
          </div>
          <div className="mt-4">
            <select
              value={activePeriod?.key ?? ""}
              onChange={(event) => setSelectedPeriodKey(event.target.value)}
              className="focus:ring-tgreen-dark focus:border-tgreen-dark w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition outline-none hover:border-gray-400 focus:ring-1"
            >
              {periods.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="col-span-2 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-6 text-sm font-semibold text-gray-900">Enterprise Traffic Comparison</h3>
          <div className="h-72">
            {reportEnterprisesQuery.isLoading ? (
              <EmptyState icon={Activity} title="Loading enterprises" description="Fetching registered enterprise accounts for analytics." minHeightClassName="min-h-72" />
            ) : reportsQuery.isLoading ? (
              <EmptyState icon={Activity} title="Loading report intake" description="Fetching synchronized enterprise report submissions." minHeightClassName="min-h-72" />
            ) : chartData.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No registered enterprises"
                description="Enterprise traffic comparisons will appear here once enterprise accounts are registered."
                minHeightClassName="min-h-72"
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} dx={-10} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                  <Bar dataKey="entries" name="Total Entries" fill="#065f46" radius={[2, 2, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="unique" name="Venue-local visitor estimate" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Accepted-report coverage</h3>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
          </div>
          <div className="max-h-75 space-y-4 overflow-y-auto pr-1">
            {coverageRows.map((row) => (
              <BarangayCoverageItem key={row.barangay} row={row} />
            ))}
            {reportEnterprisesQuery.isLoading && <EmptyState icon={ClipboardCheck} title="Loading registry" description="Fetching registered enterprise accounts." minHeightClassName="min-h-45" />}
            {!reportEnterprisesQuery.isLoading && reportsQuery.isLoading && (
              <EmptyState icon={ClipboardCheck} title="Loading submissions" description="Fetching synchronized report intake records." minHeightClassName="min-h-45" />
            )}
            {!reportEnterprisesQuery.isLoading && coverageRows.length === 0 && (
              <EmptyState
                icon={ClipboardCheck}
                title="No registered enterprises"
                description="Accepted-report coverage will appear once enterprise accounts are registered."
                minHeightClassName="min-h-45"
              />
            )}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
            Coverage currently uses the active enterprise registry. Historical compliance remains unavailable until period-specific reporting obligations are supplied by the backend.
          </p>
        </section>
      </div>
    </PageMotion>
  );
}

function BarangayCoverageItem({ row }: { row: BarangayCoverageRow }) {
  const complete = row.awaitingAcceptance === 0;

  return (
    <div className={`rounded-lg border p-3.5 transition hover:shadow-sm ${complete ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold tracking-wide uppercase ${complete ? "text-emerald-800" : "text-amber-800"}`}>{row.barangay}</span>
        <span className="shrink-0 font-mono text-[10px] text-gray-500">{row.total} total</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-emerald-100 bg-white/60 px-2 py-1.5">
          <p className="text-[10px] font-bold tracking-wide text-emerald-700 uppercase">Accepted</p>
          <p className="font-mono text-lg font-black text-emerald-800">{row.accepted}</p>
        </div>
        <div className="rounded-md border border-amber-100 bg-white/60 px-2 py-1.5">
          <p className="text-[10px] font-bold tracking-wide text-amber-700 uppercase">Awaiting acceptance</p>
          <p className="font-mono text-lg font-black text-amber-800">{row.awaitingAcceptance}</p>
        </div>
      </div>
      <p className={`mt-2 text-xs leading-normal ${complete ? "text-emerald-700" : "text-amber-700"}`}>
        {complete
          ? "All current registered enterprises have an accepted report for this period."
          : `${row.awaitingAcceptance} enterprise${row.awaitingAcceptance === 1 ? "" : "s"} do not yet have an accepted report for this period.`}
      </p>
    </div>
  );
}
