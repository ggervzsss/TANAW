import { Building2 } from "lucide-react";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
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
      <table className="w-full min-w-190 table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[25%]" />
          <col className="w-[16%]" />
          <col className="w-[22%]" />
          <col className="w-[15%]" />
          <col className="w-[22%]" />
        </colgroup>
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
            <tr key={enterprise.id} onClick={() => onSelectEnterprise(enterprise)} className="tanaw-interactive-row group cursor-pointer">
              <td className="px-6 py-4">
                <ExpandableTableText
                  primary={enterprise.name}
                  secondary={enterprise.category}
                  ariaLabel="enterprise name and category"
                  className="font-semibold"
                  secondaryClassName="text-[10px] font-normal text-gray-500"
                />
              </td>
              <td className="px-6 py-4 text-xs">
                <ExpandableTableText primary={enterprise.barangay} ariaLabel="barangay" />
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col gap-1">
                  <ReportStatusBadge status={status} />
                  <span className="font-mono text-[10px] text-gray-500">{currentReport?.code ?? "No current report"}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-xs font-bold text-gray-600">{archivedReports.length} submissions</td>
              <td className="px-6 py-4 text-xs">
                <ExpandableTableText primary={enterprise.complianceOwner} ariaLabel="compliance owner" />
              </td>
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
