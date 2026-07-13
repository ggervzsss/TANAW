import { FileText, Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { useOperationalFinalReports } from "@/shared/hooks/useOperationalSync";
import type { FinalReport } from "@/shared/types";
import { FinalReportViewer, ReportStatusBadge } from "../components";
import { recordedActor, recordedText } from "../utils/reportPresentation";

const MONTH_ORDER = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMPTY_FINAL_REPORTS: FinalReport[] = [];

export function StaffFinalReportsAuditPage() {
  const finalReportsQuery = useOperationalFinalReports();
  const finalReports = finalReportsQuery.data ?? EMPTY_FINAL_REPORTS;
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [selectedReport, setSelectedReport] = useState<FinalReport | null>(null);

  // Derive unique months and years from the live store data
  const availableMonths = useMemo(() => {
    const months = Array.from(new Set(finalReports.map((r) => r.period.split(" ")[0])));
    return months.sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
  }, [finalReports]);

  const availableYears = useMemo(() => {
    const years = Array.from(new Set(finalReports.map((r) => r.period.split(" ")[1]).filter(Boolean)));
    return years.sort((a, b) => Number(b) - Number(a));
  }, [finalReports]);

  const filteredReports = useMemo(
    () =>
      finalReports.filter((report) => {
        const [reportMonth, reportYear] = report.period.split(" ");
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery = !normalizedQuery || [report.id, report.title, report.period, report.preparedBy].some((v) => v.toLowerCase().includes(normalizedQuery));
        const matchesMonth = monthFilter === "All" || reportMonth === monthFilter;
        const matchesYear = yearFilter === "All" || reportYear === yearFilter;
        return matchesQuery && matchesMonth && matchesYear;
      }),
    [finalReports, query, monthFilter, yearFilter],
  );

  return (
    <PageMotion>
      <PageHeader title="Final Reports Audit" description="Review, print, and download official consolidated reports for DOT submission." />
      {finalReportsQuery.isError && <p className="mb-4 text-sm font-semibold text-red-600">Final reports could not be loaded from the backend. Refresh or check the API connection.</p>}

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search artifact, period, or prepared by"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
            <option value="All">All Months</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
            <option value="All">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th className="px-6 py-4">Artifact ID</th>
                <th className="px-6 py-4">Report Title & Period</th>
                <th className="px-6 py-4">Generated On</th>
                <th className="px-6 py-4">Prepared By</th>
                <th className="px-6 py-4">Totals</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredReports.map((report) => (
                <tr key={report.id} onClick={() => setSelectedReport(report)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="group-hover:text-tgreen-dark px-6 py-4 font-mono text-xs font-bold text-gray-600 transition-colors">{report.id}</td>
                  <td className="px-6 py-4 font-medium">
                    {recordedText(report.title, "Not provided")}
                    <div className="mt-0.5 text-[10px] font-normal text-gray-500">
                      Reporting period: {recordedText(report.period, "Not provided")} | Source reports: {report.sources.length}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs">{recordedText(report.generatedOn)}</td>
                  <td className="px-6 py-4 text-xs">{recordedActor(report.preparedBy)}</td>
                  <td className="px-6 py-4 font-mono text-xs">
                    <div>Entry: {report.totalEntry.toLocaleString()}</div>
                    <div>Unique: {report.totalUnique.toLocaleString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <ReportStatusBadge status={report.status} />
                  </td>
                </tr>
              ))}
              {filteredReports.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={FileText}
                      title={finalReportsQuery.isLoading ? "Loading final reports" : "No final reports"}
                      description={
                        finalReportsQuery.isLoading ? "Fetching consolidated reports from the backend." : "Consolidated reports will appear here after staff generates official submissions."
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <AnimatePresence>{selectedReport && <FinalReportViewer report={selectedReport} onClose={() => setSelectedReport(null)} />}</AnimatePresence>
    </PageMotion>
  );
}
