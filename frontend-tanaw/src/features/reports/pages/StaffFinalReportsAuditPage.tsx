import { FileText, Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { useFinalReports, useReportingPeriods } from "@/shared/hooks/useReportWorkflow";
import type { FinalReportScopeType } from "@/shared/types";
import { FinalReportViewer } from "../components";

export function StaffFinalReportsAuditPage() {
  const [query, setQuery] = useState("");
  const [periodId, setPeriodId] = useState("all");
  const [scopeType, setScopeType] = useState<"all" | FinalReportScopeType>("all");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const finalReportsQuery = useFinalReports();
  const periodsQuery = useReportingPeriods();
  const finalReports = useMemo(() => finalReportsQuery.data ?? [], [finalReportsQuery.data]);

  const periods = useMemo(() => {
    const reportPeriodIds = new Set(finalReports.map((report) => report.reportingPeriod.reportingPeriodId));
    return (periodsQuery.data ?? []).filter((period) => reportPeriodIds.has(period.reportingPeriodId));
  }, [finalReports, periodsQuery.data]);
  const filteredReports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return finalReports.filter((report) => {
      const matchesQuery =
        !needle ||
        [
          report.reportFinalizationId,
          report.reportCode,
          report.reportingPeriod.label,
          report.reportingPeriod.naturalKey,
          report.currentVersion.preparedBy.name,
          report.currentVersion.scope.label,
        ].some((value) => value.toLowerCase().includes(needle));
      return matchesQuery && (periodId === "all" || report.reportingPeriod.reportingPeriodId === periodId) && (scopeType === "all" || report.currentVersion.scope.type === scopeType);
    });
  }, [finalReports, periodId, query, scopeType]);

  return (
    <PageMotion>
      <PageHeader title="Final Reports" description="View, print, or download completed official reports." />
      {(finalReportsQuery.isError || periodsQuery.isError) && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Final reports could not be loaded. Please try again shortly.</p>
      )}

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search final reports"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 outline-none focus:ring-1"
            />
          </div>
          <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none">
            <option value="all">All reporting months</option>
            {periods.map((period) => (
              <option key={period.reportingPeriodId} value={period.reportingPeriodId}>
                {period.label}
              </option>
            ))}
          </select>
          <select
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as "all" | FinalReportScopeType)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
          >
            <option value="all">All coverage</option>
            <option value="citywide">All enterprises</option>
            <option value="barangay">One barangay</option>
            <option value="enterprise_selection">Selected enterprises</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th className="px-6 py-4">Report</th>
                <th className="px-6 py-4">Reporting Month</th>
                <th className="px-6 py-4">Coverage</th>
                <th className="px-6 py-4">Prepared by</th>
                <th className="px-6 py-4">Reports Included</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredReports.map((report) => (
                <tr key={report.reportFinalizationId} onClick={() => setSelectedReportId(report.reportFinalizationId)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-6 py-4">
                    <strong className="group-hover:text-tgreen-dark">{report.reportCode}</strong>
                  </td>
                  <td className="px-6 py-4">
                    <strong>{report.reportingPeriod.label}</strong>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <strong>{report.currentVersion.scope.label}</strong>
                    <span className="mt-1 block text-gray-500">{report.currentVersion.scope.memberCount} enterprise sites</span>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <strong>{report.currentVersion.preparedBy.name}</strong>
                    <span className="mt-1 block text-gray-500">{report.currentVersion.preparedBy.role}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{report.currentVersion.sourceCount}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedReportId(report.reportFinalizationId)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-800"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredReports.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={FileText}
                      title={finalReportsQuery.isLoading ? "Loading final reports" : "No final reports found"}
                      description={finalReportsQuery.isLoading ? "Preparing your final reports." : "No final report matches the selected filters."}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <AnimatePresence>{selectedReportId && <FinalReportViewer reportFinalizationId={selectedReportId} onClose={() => setSelectedReportId(null)} />}</AnimatePresence>
    </PageMotion>
  );
}
