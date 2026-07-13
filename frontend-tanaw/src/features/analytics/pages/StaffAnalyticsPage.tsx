import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ClipboardCheck, Users } from "lucide-react";
import { motion } from "motion/react";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { EmptyState, PageMotion, stagger } from "@/shared/components/ui";
import { useEnterpriseReports, usePeriodCompliance, useReportingPeriods } from "@/shared/hooks/useReportWorkflow";
import { formatDecimal } from "@/features/reports/utils/decimal";
import { officialAnalyticsReports } from "@/features/reports/utils/reportWorkflow";
import { getBarangayCoverageRows, getComparisonPeriod, getEnterpriseMetricRows, getTrendLabel, sumMetric, type BarangayCoverageRow } from "../utils/reportAnalytics";

export function StaffAnalyticsPage() {
  const periodsQuery = useReportingPeriods();
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const [requestedPeriodId, setRequestedPeriodId] = useState("");
  const selectedPeriodId = periods.some((period) => period.reportingPeriodId === requestedPeriodId) ? requestedPeriodId : (periods[0]?.reportingPeriodId ?? "");
  const comparisonPeriod = getComparisonPeriod(periods, selectedPeriodId);
  const reportsQuery = useEnterpriseReports({ reportingPeriodId: selectedPeriodId || undefined }, Boolean(selectedPeriodId));
  const comparisonReportsQuery = useEnterpriseReports(
    { reportingPeriodId: comparisonPeriod?.reportingPeriodId },
    Boolean(comparisonPeriod),
  );
  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const comparisonReports = useMemo(() => comparisonReportsQuery.data ?? [], [comparisonReportsQuery.data]);
  const complianceQuery = usePeriodCompliance(selectedPeriodId || null);
  const compliance = complianceQuery.data ?? null;
  const activeReports = useMemo(() => officialAnalyticsReports(reports, selectedPeriodId), [reports, selectedPeriodId]);
  const enterpriseRows = useMemo(() => getEnterpriseMetricRows(reports, selectedPeriodId), [reports, selectedPeriodId]);
  const coverageRows = useMemo(() => getBarangayCoverageRows(compliance), [compliance]);
  const chartData = enterpriseRows.map((row) => ({ name: row.enterpriseName, entries: row.entriesChart, unique: row.uniqueEstimateChart }));
  const acceptedCount = compliance ? compliance.summary.accepted + compliance.summary.consolidated : activeReports.length;
  const expectedCount = compliance?.summary.eligibleExpected ?? null;

  return (
    <PageMotion>
      <PageHeader title="Dashboard" description="Compare accepted and consolidated official report facts without counting pending or returned submissions." />

      {periods.length === 0 && !periodsQuery.isLoading && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No reporting period resource was returned by the Staff discovery endpoint. Analytics is blocked rather than inventing a period from the browser clock.</p>}
      {(reportsQuery.isError || comparisonReportsQuery.isError || periodsQuery.isError) && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Official report facts or reporting periods could not be loaded. No alternate analytics data source is used.</p>}

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4" variants={stagger}>
        <MetricCard color="#065f46" label="Total Aggregated Entries" value={formatDecimal(sumMetric(activeReports, "entries"))} foot={getTrendLabel(activeReports, comparisonPeriod, comparisonReports)} footClassName="text-tgreen-light" icon={Activity} />
        <MetricCard color="#2563eb" label="Sum of Venue Estimates" value={formatDecimal(sumMetric(activeReports, "unique_visitor_estimate"))} foot="Site estimates; not distinct citywide people" icon={Users} />
        <MetricCard color="#f59e0b" label="Accepted Report Coverage" value={expectedCount === null ? `${acceptedCount} / —` : `${acceptedCount} / ${expectedCount}`} foot={compliance ? "From frozen obligations" : "Compliance unavailable"} footClassName="text-yellow-600" icon={ClipboardCheck} />
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div><span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">Reporting Period</span><p className="mt-1 text-[11px] leading-snug text-gray-500">Only authoritative period resources returned by the server are selectable.</p></div><select value={selectedPeriodId} onChange={(event) => setRequestedPeriodId(event.target.value)} disabled={periods.length === 0} className="focus:ring-tgreen-dark mt-4 w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-1 disabled:bg-slate-100">{periods.length === 0 && <option value="">No server period</option>}{periods.map((period) => <option key={period.reportingPeriodId} value={period.reportingPeriodId}>{period.label} · {period.status}</option>)}</select></div>
      </motion.section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="col-span-2 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Official Enterprise Traffic Comparison</h3>
          <p className="mb-5 text-[11px] text-slate-500">One current accepted/consolidated revision per official report resource; enterprise totals combine each site report once.</p>
          <div className="h-72">
            {reportsQuery.isLoading ? <EmptyState icon={Activity} title="Loading official report facts" description="Following all keyset pages from the v2 endpoint." minHeightClassName="min-h-72" /> : chartData.length === 0 ? <EmptyState icon={Activity} title="No official accepted facts" description="Pending and returned submissions are intentionally excluded." minHeightClassName="min-h-72" /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.15} /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} dy={10} /><YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} dx={-10} /><Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ backgroundColor: "#1f2937", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px" }} /><Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} /><Bar dataKey="entries" name="Total Entries" fill="#065f46" radius={[2, 2, 0, 0]} maxBarSize={40} /><Bar dataKey="unique" name="Venue-local visitor estimate" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} /></BarChart></ResponsiveContainer>}
          </div>
          {enterpriseRows.length > 0 && <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase"><tr><th className="px-3 py-2">Enterprise</th><th className="px-3 py-2">Exact entries</th><th className="px-3 py-2">Exact venue estimate</th><th className="px-3 py-2">Official site reports</th></tr></thead><tbody>{enterpriseRows.map((row) => <tr key={row.enterpriseId} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{row.enterpriseName}</td><td className="px-3 py-2 font-mono">{formatDecimal(row.entriesExact)}</td><td className="px-3 py-2 font-mono">{formatDecimal(row.uniqueEstimateExact)}</td><td className="px-3 py-2 font-mono">{row.reports.length}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-6 text-sm font-semibold text-gray-900">Frozen obligation coverage</h3>
          <div className="max-h-75 space-y-4 overflow-y-auto pr-1">
            {coverageRows.map((row) => <BarangayCoverageItem key={row.barangay} row={row} />)}
            {complianceQuery.isLoading && <EmptyState icon={ClipboardCheck} title="Loading compliance" description="Fetching the frozen obligation snapshot." minHeightClassName="min-h-45" />}
            {!complianceQuery.isLoading && coverageRows.length === 0 && <EmptyState icon={ClipboardCheck} title="Compliance unavailable" description="Coverage is never inferred from the submitted-report list alone." minHeightClassName="min-h-45" />}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-gray-500">Not-submitted and awaiting counts are derived only from frozen eligible obligations. Exempt, ineligible, simulation, and unresolved records are not presented as accepted coverage.</p>
        </section>
      </div>
    </PageMotion>
  );
}

function BarangayCoverageItem({ row }: { row: BarangayCoverageRow }) {
  const complete = row.awaitingAcceptance === 0;
  return <div className={`rounded-lg border p-3.5 ${complete ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}><div className="flex items-center justify-between"><span className={`text-xs font-bold tracking-wide uppercase ${complete ? "text-emerald-800" : "text-amber-800"}`}>{row.barangay}</span><span className="font-mono text-[10px] text-gray-500">{row.total} eligible</span></div><div className="mt-3 grid grid-cols-2 gap-2"><CoverageValue label="Accepted" value={row.accepted} tone="emerald" /><CoverageValue label="Awaiting" value={row.awaitingAcceptance} tone="amber" /></div></div>;
}

function CoverageValue({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" }) {
  return <div className={`rounded-md border bg-white/60 px-2 py-1.5 ${tone === "emerald" ? "border-emerald-100 text-emerald-800" : "border-amber-100 text-amber-800"}`}><p className="text-[10px] font-bold tracking-wide uppercase">{label}</p><p className="font-mono text-lg font-black">{value}</p></div>;
}
