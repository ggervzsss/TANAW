import { Activity } from "lucide-react";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
import type { SystemLog } from "@/shared/types";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { SystemLogTypeBadge } from "./ActivityBadges";

export function ITSystemLogsTable({
  activities,
  isLoading,
  timeFormat,
  onSelect,
}: {
  activities: SystemLog[];
  isLoading: boolean;
  timeFormat: SystemTimeFormat;
  onSelect: (activity: SystemLog) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-190 table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[15%]" />
          <col className="w-[18%]" />
          <col className="w-[20%]" />
          <col className="w-[29%]" />
        </colgroup>
        <thead className="bg-gray-50 text-[11px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            {["Date and Time", "Type", "Name", "Affected Item", "What Happened"].map((heading) => (
              <th key={heading} className="px-3 py-4 whitespace-nowrap lg:px-4">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {activities.map((activity) => (
            <tr key={activity.id} onClick={() => onSelect(activity)} className="tanaw-interactive-row cursor-pointer">
              <td className="px-3 py-4 font-mono text-xs whitespace-nowrap text-gray-500 lg:px-4">{formatPhilippineDateTime(activity.timestamp, timeFormat)}</td>
              <td className="px-3 py-4 whitespace-nowrap lg:px-4">
                <SystemLogTypeBadge type={activity.category} />
              </td>
              <td className="px-3 py-4 text-sm lg:px-4">
                <ExpandableTableText
                  primary={activity.actor}
                  secondary={activity.actorRole}
                  ariaLabel="actor"
                  className="font-bold text-gray-900"
                  secondaryClassName="text-[11px] font-semibold text-gray-500 uppercase"
                />
              </td>
              <td className="px-3 py-4 text-sm text-gray-600 lg:px-4">
                <ExpandableTableText primary={activity.target} ariaLabel="target" />
              </td>
              <td className="px-3 py-4 text-sm leading-relaxed text-gray-600 lg:px-4">
                <ExpandableTableText primary={activity.summary} ariaLabel="summary" twoLines />
              </td>
            </tr>
          ))}
          {activities.length === 0 && (
            <EmptyTableRow
              isLoading={isLoading}
              title="No system activity"
              loadingTitle="Loading system activity"
              description="System activity records will appear here once users, accounts, and automated events are connected."
              loadingDescription="Fetching live IT and system activity."
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTableRow({
  isLoading,
  title,
  loadingTitle,
  description,
  loadingDescription,
}: {
  isLoading: boolean;
  title: string;
  loadingTitle: string;
  description: string;
  loadingDescription: string;
}) {
  return (
    <tr>
      <td colSpan={5}>
        <EmptyState icon={Activity} title={isLoading ? loadingTitle : title} description={isLoading ? loadingDescription : description} />
      </td>
    </tr>
  );
}
