import { FileText, Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { useFinalReports, useReportingPeriods } from "@/shared/hooks/useReportWorkflow";
import type { FinalReportScopeType } from "@/shared/types";
import { FinalReportViewer, ReportStatusBadge } from "../components";
import { readableToken } from "../utils/reportWorkflow";

export function StaffFinalReportsAuditPage() {
  const [query, setQuery] = useState("");
  const [periodId, setPeriodId] = useState("all");
  const [scopeType, setScopeType] = useState<"all" | FinalReportScopeType>("all");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const finalReportsQuery = useFinalReports({
    reportingPeriodId: periodId === "all" ? undefined : periodId,
    scopeType: scopeType === "all" ? undefined : scopeType,
  });
  const periodsQuery = useReportingPeriods();
  const finalReports = useMemo(() => finalReportsQuery.data ?? [], [finalReportsQuery.data]);

  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const filteredReports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return finalReports.filter((report) => {
      const matchesQuery = !needle || [report.reportFinalizationId, report.reportCode, report.reportingPeriod.label, report.reportingPeriod.naturalKey, report.currentVersion.preparedBy.name, report.currentVersion.scope.label].some((value) => value.toLowerCase().includes(needle));
      return matchesQuery && (periodId === "all" || report.reportingPeriod.reportingPeriodId === periodId) && (scopeType === "all" || report.currentVersion.scope.type === scopeType);
    });
  }, [finalReports, periodId, query, scopeType]);

  return (
    <PageMotion>
      <PageHeader title="Final Reports Audit" description="Inspect every immutable official version, frozen scope member, exact source revision, and recorded finalization event." />
      {(finalReportsQuery.isError || periodsQuery.isError) && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Official final-report or reporting-period v2 resources could not be loaded. No alternate list is used.</p>}

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1"><Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search report code, immutable ID, period, scope, or preparer" className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 outline-none focus:ring-1" /></div>
          <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none"><option value="all">All server periods</option>{periods.map((period) => <option key={period.reportingPeriodId} value={period.reportingPeriodId}>{period.label} · {period.status}</option>)}</select>
          <select value={scopeType} onChange={(event) => setScopeType(event.target.value as "all" | FinalReportScopeType)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none"><option value="all">All scopes</option><option value="citywide">Citywide</option><option value="barangay">Barangay</option><option value="enterprise_selection">Enterprise selection</option></select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase"><tr><th className="px-6 py-4">Report</th><th className="px-6 py-4">Server period</th><th className="px-6 py-4">Frozen scope</th><th className="px-6 py-4">Prepared by</th><th className="px-6 py-4">Version</th><th className="px-6 py-4">Artifact evidence</th></tr></thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredReports.map((report) => (
                <tr key={report.reportFinalizationId} onClick={() => setSelectedReportId(report.reportFinalizationId)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-6 py-4"><strong className="group-hover:text-tgreen-dark">{report.reportCode}</strong><span className="mt-1 block font-mono text-[10px] text-gray-500">{report.reportFinalizationId}</span></td>
                  <td className="px-6 py-4"><strong>{report.reportingPeriod.label}</strong><span className="mt-1 block font-mono text-[10px] text-gray-500">{report.reportingPeriod.naturalKey}</span></td>
                  <td className="px-6 py-4 text-xs"><strong>{report.currentVersion.scope.label}</strong><span className="mt-1 block text-gray-500">{readableToken(report.currentVersion.scope.type)} · {report.currentVersion.scope.memberCount} members</span></td>
                  <td className="px-6 py-4 text-xs"><strong>{report.currentVersion.preparedBy.name}</strong><span className="mt-1 block text-gray-500">{report.currentVersion.preparedBy.role}</span></td>
                  <td className="px-6 py-4"><ReportStatusBadge status={report.currentVersion.disposition} /><span className="mt-2 block font-mono text-[10px] text-gray-500">v{report.currentVersion.versionNumber} · {report.currentVersion.sourceCount} sources</span></td>
                  <td className="px-6 py-4"><div className="flex flex-wrap gap-1">{report.currentVersion.artifacts.map((artifact) => <ReportStatusBadge key={artifact.artifactId} status={artifact.status} />)}{report.currentVersion.artifacts.length === 0 && <span className="text-xs text-gray-500">No artifact record</span>}</div></td>
                </tr>
              ))}
              {filteredReports.length === 0 && <tr><td colSpan={6}><EmptyState icon={FileText} title={finalReportsQuery.isLoading ? "Loading final reports" : "No immutable final reports"} description={finalReportsQuery.isLoading ? "Following all keyset pages from the official v2 endpoint." : "No final report matches the selected authoritative filters."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <AnimatePresence>{selectedReportId && <FinalReportViewer reportFinalizationId={selectedReportId} onClose={() => setSelectedReportId(null)} />}</AnimatePresence>
    </PageMotion>
  );
}
