import { Building2 } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import type { ReportEnterprise } from "@/shared/types";
import type { EnterpriseReportRow } from "../utils";
import { ReportStatusBadge } from "./ReportStatusBadge";

type BatchReportsTableProps = {
  rows: EnterpriseReportRow[];
  isLoading: boolean;
  onSelectEnterprise: (enterprise: ReportEnterprise) => void;
};

export function BatchReportsTable({ rows, isLoading, onSelectEnterprise }: BatchReportsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            <th className="px-6 py-4">Enterprise</th>
            <th className="px-6 py-4">Barangay</th>
            <th className="px-6 py-4">Current Submission</th>
            <th className="px-6 py-4">Archived</th>
            <th className="px-6 py-4">Compliance Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {rows.map(({ enterprise, currentReport, archivedReports, status }) => (
            <tr key={enterprise.id} onClick={() => onSelectEnterprise(enterprise)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
              <td className="px-6 py-4 font-semibold">
                {enterprise.name}
                <div className="mt-1 text-[10px] font-normal text-gray-500">{enterprise.category}</div>
              </td>
              <td className="px-6 py-4 text-xs">{enterprise.barangay}</td>
              <td className="px-6 py-4">
                <div className="flex flex-col gap-1">
                  <ReportStatusBadge status={status} />
                  <span className="font-mono text-[10px] text-gray-500">{currentReport?.code ?? "No current report"}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-xs font-bold text-gray-600">{archivedReports.length} submissions</td>
              <td className="px-6 py-4 text-xs">{enterprise.complianceOwner}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={Building2}
                  title={isLoading ? "Loading enterprises" : "No report enterprises"}
                  description={isLoading ? "Fetching registered enterprise accounts." : "Enterprise report rows will appear here once registered establishments are connected to reporting."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
