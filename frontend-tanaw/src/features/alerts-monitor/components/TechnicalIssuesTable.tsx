import { Bell } from "lucide-react";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { getTechnicalIssueStatusLabel } from "../model";
import { AlertStatusBadge, ResolutionBadge, UrgencyBadge } from "./PriorityAlertComponents";

type TechnicalIssuesTableProps = {
  alerts: PriorityAlert[];
  filteredAlerts: PriorityAlert[];
  onOpen: (alertId: string) => void;
  onStatusChange: (alert: PriorityAlert, status: PriorityAlertStatus) => void;
  timeFormat: SystemTimeFormat;
};

export function TechnicalIssuesTable({ alerts, filteredAlerts, onOpen, onStatusChange, timeFormat }: TechnicalIssuesTableProps) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-240 table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[25%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Issue ID", "Problem", "Urgency", "Affected Account", "What to Do", "Status", "Actions"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {filteredAlerts.map((alert) => (
              <tr key={alert.id} onClick={() => onOpen(alert.id)} className="tanaw-interactive-row group cursor-pointer">
                <td className="px-4 py-4 font-mono text-xs font-bold text-gray-600">{alert.id}</td>
                <td className="px-4 py-4">
                  <div className="font-semibold text-gray-900">{alert.type}</div>
                  <div className="mt-1">
                    <ResolutionBadge mode={alert.resolutionMode} />
                  </div>
                </td>
                <td className="px-4 py-4">
                  <UrgencyBadge urgency={alert.urgency} />
                </td>
                <td className="px-4 py-4">
                  <ExpandableTableText
                    primary={alert.enterprise ?? alert.requester}
                    secondary={alert.requester}
                    ariaLabel="alert source"
                    className="font-semibold text-gray-900"
                    secondaryClassName="text-[10px] font-bold tracking-wide text-gray-500 uppercase"
                  />
                </td>
                <td className="px-4 py-4">
                  <ExpandableTableText
                    primary={alert.summary}
                    secondary={alert.requiredAction}
                    ariaLabel="alert summary and required action"
                    className="text-xs leading-relaxed font-semibold text-gray-700"
                    secondaryClassName="text-xs leading-relaxed text-gray-500"
                    twoLines
                  />
                </td>
                <td className="px-4 py-4">
                  <AlertStatusBadge status={alert.status} label={getTechnicalIssueStatusLabel(alert.status)} />
                  <time dateTime={alert.time} className="mt-2 block text-[10px] font-bold tracking-wide text-gray-400 uppercase">
                    {formatPhilippineDateTime(alert.time, timeFormat)}
                  </time>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-2">
                    <StatusButton disabled={alert.status === "In Review" || alert.status === "Resolved"} onClick={() => onStatusChange(alert, "In Review")}>
                      Start Work
                    </StatusButton>
                    <StatusButton disabled={alert.status === "Resolved"} onClick={() => onStatusChange(alert, "Resolved")}>
                      Resolve
                    </StatusButton>
                  </div>
                </td>
              </tr>
            ))}
            {filteredAlerts.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={Bell} title="No technical issues" description="Camera, desktop application, data update, and account problems that need IT attention will appear here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
        <span>Showing {filteredAlerts.length} technical issues</span>
        <span>{alerts.length} total IT issues</span>
      </div>
    </>
  );
}

function StatusButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-bold tracking-wide text-gray-600 uppercase transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
    >
      {children}
    </button>
  );
}
