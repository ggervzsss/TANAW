import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ClipboardCheck, Users } from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { EmptyState, FilterSelect, PageMotion, stagger } from "@/shared/components/ui";
import { useOperationalReports } from "@/shared/hooks/useOperationalSync";
import { listReportEnterprises } from "@/shared/services/reporting";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";

const MONTH_ORDER = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMPTY_REPORT_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_INTAKE_REPORTS: IntakeReport[] = [];

type AnalyticsPeriod = {
  key: string;
  label: string;
  monthIndex: number;
  reports: IntakeReport[];
  year: string;
};

type EnterpriseReportRow = {
  enterprise: ReportEnterprise;
  reports: IntakeReport[];
  submitted: boolean;
};

type BarangayComplianceRow = {
  barangay: string;
  complete: number;
  pending: number;
  total: number;
};

function getReportYear(report: IntakeReport) {
  const periodYear = report.period.match(/\d{4}/)?.[0];
  if (periodYear) return periodYear;

  const submittedAtYear = getDateYear(report.submittedAt);
  if (submittedAtYear) return submittedAtYear;

  return getDateYear(report.submitted);
}

function getAnalyticsPeriods(reports: IntakeReport[], currentPeriod: AnalyticsPeriod) {
  const periodMap = new Map<string, AnalyticsPeriod>();
  periodMap.set(currentPeriod.key, currentPeriod);

  reports.forEach((report) => {
    const year = getReportYear(report);
    const monthIndex = MONTH_ORDER.indexOf(report.month);
    if (!year || monthIndex === -1) return;

    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const period = periodMap.get(key) ?? {
      key,
      label: `${report.month} ${year}`,
      monthIndex,
      reports: [],
      year,
    };

    period.reports.push(report);
    periodMap.set(key, period);
  });

  return Array.from(periodMap.values()).sort((a, b) => Number(b.year) - Number(a.year) || b.monthIndex - a.monthIndex);
}

function sumMetric(reports: IntakeReport[], metric: "entry" | "unique") {
  return reports.reduce((total, report) => total + report.metrics[metric], 0);
}

function reportHasSubmission(report: IntakeReport) {
  return report.submitted !== "Not submitted";
}

function getCurrentAnalyticsPeriod(date = new Date()): AnalyticsPeriod {
  const monthIndex = date.getMonth();
  const month = MONTH_ORDER[monthIndex];
  const year = String(date.getFullYear());

  return {
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    label: `${month} ${year}`,
    monthIndex,
    reports: [],
    year,
  };
}

function getTrendLabel(activeReports: IntakeReport[], comparisonPeriod?: AnalyticsPeriod) {
  if (!comparisonPeriod) return "No earlier reporting period";

  const activeEntries = sumMetric(activeReports, "entry");
  const comparisonEntries = sumMetric(comparisonPeriod.reports, "entry");
  if (comparisonEntries === 0) return `Compared with ${comparisonPeriod.label}`;

  const difference = Math.round(((activeEntries - comparisonEntries) / comparisonEntries) * 100);
  const sign = difference > 0 ? "+" : "";
  return `${sign}${difference}% vs ${comparisonPeriod.label}`;
}

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
  const activeReports = activePeriod?.reports ?? EMPTY_INTAKE_REPORTS;
  const enterpriseRows = useMemo(() => getEnterpriseReportRows(reportEnterprises, activeReports), [activeReports, reportEnterprises]);
  const submittedRows = enterpriseRows.filter((row) => row.submitted);
  const totalReports = reportEnterprises.length;
  const totalPendingReports = Math.max(0, totalReports - submittedRows.length);
  const submissionRate = totalReports === 0 ? 0 : Math.round((submittedRows.length / totalReports) * 100);
  const comparisonPeriod = periods[activePeriodIndex + 1];
  const chartData = enterpriseRows.map(({ enterprise, reports, submitted }) => ({
    name: enterprise.name,
    entries: sumMetric(reports, "entry"),
    unique: sumMetric(reports, "unique"),
    status: submitted ? "Submitted" : "Missing",
  }));
  const complianceRows = useMemo(() => getBarangayComplianceRows(enterpriseRows), [enterpriseRows]);

  return (
    <PageMotion className="tanaw-staff-dashboard pb-12">
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
        <MetricCard color="#2563eb" label="Est. Unique People" value={sumMetric(activeReports, "unique")} foot="From reporting submissions" icon={Users} />
        <MetricCard
          color="#f59e0b"
          label="Reports Compliance"
          value={`${submittedRows.length} / ${totalReports}`}
          foot={`${submissionRate}% Submission Rate`}
          footClassName="text-yellow-600"
          icon={ClipboardCheck}
        />
        <div className="tanaw-dashboard-panel flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">Reporting Period</span>
            <p className="mt-1 text-[11px] leading-snug text-gray-500">Filter comparative data and live update history by calendar month.</p>
          </div>
          <div className="mt-4">
            <FilterSelect
              value={activePeriod?.key ?? ""}
              onChange={setSelectedPeriodKey}
              options={periods.map((period) => [period.key, period.label] as const)}
              ariaLabel="Reporting period"
              className="w-full"
            />
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="tanaw-dashboard-panel col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tanaw-chart-grid)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--tanaw-chart-axis)" }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--tanaw-chart-axis)" }} axisLine={false} tickLine={false} dx={-10} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    contentStyle={{
                      backgroundColor: "var(--tanaw-chart-tooltip-bg)",
                      color: "var(--tanaw-chart-tooltip-text)",
                      border: "1px solid var(--tanaw-border-subtle)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      boxShadow: "var(--tanaw-shadow-raised)",
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                  <Bar dataKey="entries" name="Total Entries" fill="#065f46" radius={[2, 2, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="unique" name="Unique Pax" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="tanaw-dashboard-panel flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Compliance Status</h3>
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2" aria-label={`${submittedRows.length} complete reports and ${totalPendingReports} pending reports`}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black tracking-wide text-emerald-800 uppercase dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                Complete <strong className="font-mono text-xs">{submittedRows.length}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black tracking-wide text-amber-800 uppercase dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200">
                Pending <strong className="font-mono text-xs">{totalPendingReports}</strong>
              </span>
            </div>
          </div>
          <div className="max-h-75 space-y-4 overflow-y-auto pr-1">
            {complianceRows.map((row) => (
              <BarangayComplianceItem key={row.barangay} row={row} />
            ))}
            {reportEnterprisesQuery.isLoading && <EmptyState icon={ClipboardCheck} title="Loading registry" description="Fetching registered enterprise accounts." minHeightClassName="min-h-45" />}
            {!reportEnterprisesQuery.isLoading && reportsQuery.isLoading && (
              <EmptyState icon={ClipboardCheck} title="Loading submissions" description="Fetching synchronized report intake records." minHeightClassName="min-h-45" />
            )}
            {!reportEnterprisesQuery.isLoading && complianceRows.length === 0 && (
              <EmptyState icon={ClipboardCheck} title="No registered enterprises" description="Compliance status will appear once enterprise accounts are registered." minHeightClassName="min-h-45" />
            )}
          </div>
        </section>
      </div>
    </PageMotion>
  );
}

function getEnterpriseReportRows(enterprises: ReportEnterprise[], reports: IntakeReport[]): EnterpriseReportRow[] {
  const reportsByEnterprise = reports.reduce<Map<string, IntakeReport[]>>((map, report) => {
    const enterpriseReports = map.get(report.enterpriseId) ?? [];
    enterpriseReports.push(report);
    map.set(report.enterpriseId, enterpriseReports);
    return map;
  }, new Map());

  return enterprises.map((enterprise) => ({
    enterprise,
    reports: reportsByEnterprise.get(enterprise.id) ?? [],
    submitted: (reportsByEnterprise.get(enterprise.id) ?? []).some(reportHasSubmission),
  }));
}

function getBarangayComplianceRows(rows: EnterpriseReportRow[]): BarangayComplianceRow[] {
  const rowsByBarangay = rows.reduce<Map<string, BarangayComplianceRow>>((map, row) => {
    const barangay = row.enterprise.barangay || "Unassigned";
    const current = map.get(barangay) ?? { barangay, complete: 0, pending: 0, total: 0 };
    current.total += 1;
    if (row.submitted) {
      current.complete += 1;
    } else {
      current.pending += 1;
    }
    map.set(barangay, current);
    return map;
  }, new Map());

  return Array.from(rowsByBarangay.values()).sort((left, right) => left.barangay.localeCompare(right.barangay));
}

function BarangayComplianceItem({ row }: { row: BarangayComplianceRow }) {
  const complete = row.pending === 0;

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        complete ? "border-emerald-100 bg-emerald-50 dark:border-emerald-300/20 dark:bg-emerald-500/10" : "border-amber-100 bg-amber-50 dark:border-amber-300/20 dark:bg-amber-400/10"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold tracking-wide uppercase ${complete ? "text-emerald-800" : "text-amber-800"}`}>{row.barangay}</span>
        <span className="shrink-0 font-mono text-[10px] text-gray-500">{row.total} total</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="tanaw-dashboard-inset rounded-lg border border-emerald-100 bg-white/60 px-2 py-1.5 dark:border-emerald-300/20">
          <p className="text-[10px] font-bold tracking-wide text-emerald-700 uppercase">Complete</p>
          <p className="font-mono text-lg font-black text-emerald-800">{row.complete}</p>
        </div>
        <div className="tanaw-dashboard-inset rounded-lg border border-amber-100 bg-white/60 px-2 py-1.5 dark:border-amber-300/20">
          <p className="text-[10px] font-bold tracking-wide text-amber-700 uppercase">Pending</p>
          <p className="font-mono text-lg font-black text-amber-800">{row.pending}</p>
        </div>
      </div>
      <p className={`mt-2 text-xs leading-normal ${complete ? "text-emerald-700" : "text-amber-700"}`}>
        {complete ? "All registered enterprises submitted for this period." : `${row.pending} enterprise${row.pending === 1 ? "" : "s"} still pending for this period.`}
      </p>
    </div>
  );
}

function getDateYear(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getFullYear()) : null;
}
