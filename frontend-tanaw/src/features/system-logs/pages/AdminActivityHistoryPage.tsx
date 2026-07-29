import { Activity, CalendarDays, FileCheck2, Search, ShieldAlert, TicketCheck, UserCheck } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { DetailField, EmptyState, ExpandableTableText, FilterSelect, ModalFrame, PageMotion } from "@/shared/components/ui";
import { useActivityLogs } from "@/shared/hooks/useActivityLogs";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { SystemLog } from "@/shared/types";
import { activityTimeRanges, isWithinActivityTimeRange } from "@/shared/utils";
import type { ActivityTimeRange } from "@/shared/utils";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type ActivityGroup = "All Activity" | "Reports" | "Admin Activity" | "Accounts & Settings" | "Issues & Resolutions" | "Security";

const activityGroups: ActivityGroup[] = ["All Activity", "Reports", "Admin Activity", "Accounts & Settings", "Issues & Resolutions", "Security"];

export function AdminActivityHistoryPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const { logs, isLoading } = useActivityLogs();
  const [query, setQuery] = useState("");
  const [activityGroup, setActivityGroup] = useState<ActivityGroup>("All Activity");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("All Time");
  const [selectedActivity, setSelectedActivity] = useState<SystemLog | null>(null);

  const sortedLogs = useMemo(() => [...logs].sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp)), [logs]);
  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedLogs.filter((log) => {
      const group = activityGroupFor(log);
      const searchable = [log.action, log.actor, log.target, log.summary, group].join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesGroup = activityGroup === "All Activity" || group === activityGroup;
      const matchesTimeRange = isWithinActivityTimeRange(log.timestamp, timeRange);
      return matchesQuery && matchesGroup && matchesTimeRange;
    });
  }, [activityGroup, query, sortedLogs, timeRange]);

  const todayCount = logs.filter((log) => isWithinActivityTimeRange(log.timestamp, "Today")).length;
  const reportCount = logs.filter((log) => activityGroupFor(log) === "Reports").length;
  const adminCount = logs.filter((log) => activityGroupFor(log) === "Admin Activity").length;
  const importantCount = logs.filter((log) => ["Issues & Resolutions", "Security"].includes(activityGroupFor(log))).length;

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Activity History" description="Review important report, Admin, account, issue, and security activity across TANAW." />

      <UnifiedMetricsHeader
        ariaLabel="Activity history summary"
        metrics={[
          { id: "today", title: "Today", value: todayCount, description: "Activity recorded today", tone: "info", icon: CalendarDays, isLoading },
          { id: "report-updates", title: "Report Updates", value: reportCount, description: "Staff reporting activity", tone: "teal", icon: FileCheck2, isLoading },
          { id: "admin-activity", title: "Admin Activity", value: adminCount, description: "Actions by Admin accounts", tone: "success", icon: UserCheck, isLoading },
          {
            id: "important-updates",
            title: "Important Updates",
            value: importantCount,
            description: "Issues and security records",
            tone: "warning",
            icon: ShieldAlert,
            isLoading,
          },
        ]}
      />

      <Panel className="tanaw-data-panel mt-6 overflow-hidden">
        <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activity, name, affected item, or details"
              className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={activityGroup} onChange={(value) => setActivityGroup(value as ActivityGroup)} options={activityGroups} />
          <FilterSelect value={timeRange} onChange={(value) => setTimeRange(value as ActivityTimeRange)} options={activityTimeRanges} />
        </div>

        <div className="tanaw-data-table overflow-x-auto">
          <table className="w-full min-w-210 table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[24%]" />
              <col className="w-[19%]" />
              <col className="w-[17%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
              <tr>
                {["Date and Time", "Activity", "Performed By", "Affected Item", "Details"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
              {filteredLogs.map((log) => {
                const group = activityGroupFor(log);
                return (
                  <tr key={log.id} onClick={() => setSelectedActivity(log)} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
                    <td className="px-4 py-4 font-mono text-xs text-gray-500">{formatPhilippineDateTime(log.timestamp, timeFormat)}</td>
                    <td className="px-4 py-4">
                      <ExpandableTableText primary={log.action} ariaLabel="activity" className="font-semibold text-gray-900" />
                      <div className="mt-1.5">
                        <ActivityGroupBadge group={group} />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <ExpandableTableText primary={log.actor} ariaLabel="person or system that performed the activity" className="font-semibold text-gray-900" />
                    </td>
                    <td className="px-4 py-4">
                      <ExpandableTableText primary={log.target} ariaLabel="affected item" className="text-sm font-medium text-gray-700" />
                    </td>
                    <td className="px-4 py-4 text-xs leading-relaxed text-gray-600">
                      <ExpandableTableText primary={log.summary} ariaLabel="activity details" twoLines />
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Activity}
                      title={isLoading ? "Loading activity history" : "No activity found"}
                      description={isLoading ? "Loading important TANAW activity." : "No recorded activity matches the selected filters."}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="tanaw-data-footer flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {filteredLogs.length} records</span>
          <span>{timeRange}</span>
        </div>
      </Panel>

      <AnimatePresence>{selectedActivity && <ActivityDetailsModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}</AnimatePresence>
    </PageMotion>
  );
}

function ActivityDetailsModal({ activity, onClose }: { activity: SystemLog; onClose: () => void }) {
  const navigate = useNavigate();
  const supportTicketId = supportTicketIdFromActivity(activity);

  const openTicket = () => {
    if (!supportTicketId) return;
    onClose();
    navigate(`${routes.admin.operations}?view=support&ticket=${encodeURIComponent(supportTicketId)}`);
  };

  return (
    <ModalFrame title="Activity Details" eyebrow={activityGroupFor(activity)} onClose={onClose} maxWidthClassName="max-w-4xl">
      <AdminActivityDetailFields activity={activity} />
      {supportTicketId && (
        <div className="mt-5 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-700">This update is connected to an enterprise support request. Open it to review the request, photos, status, and IT response.</p>
          <button
            type="button"
            onClick={openTicket}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <TicketCheck size={14} />
            Open Support Request
          </button>
        </div>
      )}
    </ModalFrame>
  );
}

export function AdminActivityDetailFields({ activity }: { activity: SystemLog }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const expandableValue = (value: string, label: string) => <ExpandableTableText primary={value} ariaLabel={label} twoLines className="leading-relaxed font-semibold" />;

  return (
    <div className="tanaw-detail-grid grid gap-4 md:grid-cols-2">
      <DetailField label="Date and Time" value={formatPhilippineDateTime(activity.timestamp, timeFormat)} />
      <DetailField label="Activity Type" value={<ActivityGroupBadge group={activityGroupFor(activity)} />} />
      <DetailField label="Activity" value={expandableValue(activity.action, "activity")} />
      <DetailField label="Performed By" value={expandableValue(activity.actor, "person or system")} />
      <DetailField label="Affected Item" value={expandableValue(activity.target, "affected item")} />
      <DetailField label="Details" value={expandableValue(activity.summary, "activity details")} />
    </div>
  );
}

function ActivityGroupBadge({ group }: { group: Exclude<ActivityGroup, "All Activity"> }) {
  const classes: Record<Exclude<ActivityGroup, "All Activity">, string> = {
    Reports: "border-teal-200 bg-teal-50 text-teal-700",
    "Admin Activity": "border-indigo-200 bg-indigo-50 text-indigo-700",
    "Accounts & Settings": "border-blue-200 bg-blue-50 text-blue-700",
    "Issues & Resolutions": "border-amber-200 bg-amber-50 text-amber-700",
    Security: "border-red-200 bg-red-50 text-red-700",
  };
  return <span className={`inline-flex rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${classes[group]}`}>{group}</span>;
}

function activityGroupFor(log: SystemLog): Exclude<ActivityGroup, "All Activity"> {
  if (log.category === "Staff Submission" || log.category === "Staff Operation") return "Reports";
  if (log.category === "Admin Operation") return "Admin Activity";
  if (log.action.startsWith("Alert ") || log.action.includes("Support Request") || log.action === "Update Support Ticket Status") return "Issues & Resolutions";
  if (log.category === "System" || log.severity === "Critical") return "Security";
  return "Accounts & Settings";
}

function timestampValue(timestamp: string) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}

function supportTicketIdFromActivity(log: SystemLog) {
  if (!log.sourceId) return null;
  const text = [log.action, log.target, log.summary, log.sourceId].join(" ").toLowerCase();
  return text.includes("ticket") || text.includes("tck-") ? log.sourceId : null;
}
