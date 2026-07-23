import { Activity, Search, TicketCheck } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { DetailField, EmptyState, ExpandableTableText, FilterSelect, ModalFrame, PageMotion } from "@/shared/components/ui";
import { useActivityLogs } from "@/shared/hooks/useActivityLogs";
import type { SystemLog, SystemLogCategory } from "@/shared/types";
import { activityTimeRanges, isWithinActivityTimeRange } from "@/shared/utils";
import type { ActivityTimeRange } from "@/shared/utils";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";

const defaultTypeOptions = ["All Types", "IT Activity", "Enterprise Activity", "System"];
const defaultAccountOptions = ["All Accounts", "IT Personnel", "Enterprise Account", "System"];

export function ITSystemLogsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const { logs, isLoading } = useActivityLogs();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [accountFilter, setAccountFilter] = useState("All Accounts");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("All Time");
  const [showRoutineActivity, setShowRoutineActivity] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<SystemLog | null>(null);

  const dynamicTypeOptions = useMemo(() => getTypeOptions(logs, accountFilter), [accountFilter, logs]);
  const dynamicAccountOptions = useMemo(() => getAccountOptions(logs, typeFilter), [logs, typeFilter]);

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
    if (!getAccountOptions(logs, value).includes(accountFilter)) {
      setAccountFilter("All Accounts");
    }
  };

  const handleAccountFilterChange = (value: string) => {
    setAccountFilter(value);
    if (!getTypeOptions(logs, value).includes(typeFilter)) {
      setTypeFilter("All Types");
    }
  };

  const filteredActivities = useMemo(() => {
    return logs.filter((activity) => {
      const haystack = `${activity.summary} ${activity.actor} ${activity.target} ${activity.action}`.toLowerCase();
      const matchesQuery = haystack.includes(query.trim().toLowerCase());
      const matchesType = typeFilter === "All Types" || activity.category === typeFilter;
      const matchesAccount = accountFilter === "All Accounts" || activity.actorRole === accountFilter;
      const matchesTimeRange = isWithinActivityTimeRange(activity.timestamp, timeRange);
      const matchesImportance = showRoutineActivity || !isRoutineActivity(activity);
      return matchesQuery && matchesType && matchesAccount && matchesTimeRange && matchesImportance;
    });
  }, [accountFilter, logs, query, showRoutineActivity, timeRange, typeFilter]);

  return (
    <PageMotion>
      <PageHeader title="System Activity" description="A searchable history of important account changes, technical issues, and IT actions." />

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:min-w-64">
              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search summary or name"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1 focus:ring-emerald-600"
              />
            </div>
            <FilterSelect value={typeFilter} onChange={handleTypeFilterChange} options={dynamicTypeOptions} />
            <FilterSelect value={accountFilter} onChange={handleAccountFilterChange} options={dynamicAccountOptions} />
            <FilterSelect value={timeRange} onChange={(value) => setTimeRange(value as ActivityTimeRange)} options={activityTimeRanges} />
            <button
              type="button"
              onClick={() => setShowRoutineActivity((current) => !current)}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${showRoutineActivity ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-white text-gray-600 hover:border-emerald-300"}`}
            >
              {showRoutineActivity ? "Hide routine activity" : "Show routine activity"}
            </button>
          </div>
        </div>

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
              {filteredActivities.map((activity) => (
                <tr key={activity.id} onClick={() => setSelectedActivity(activity)} className="tanaw-interactive-row cursor-pointer">
                  <td className="px-3 py-4 font-mono text-xs whitespace-nowrap text-gray-500 lg:px-4">{formatLogTimestamp(activity.timestamp, timeFormat)}</td>
                  <td className="px-3 py-4 whitespace-nowrap lg:px-4">
                    <TypeBadge type={activity.category} />
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
              {filteredActivities.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Activity}
                      title={isLoading ? "Loading system activity" : "No system activity"}
                      description={isLoading ? "Fetching live IT and system activity." : "System activity records will appear here once users, accounts, and automated events are connected."}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[11px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {filteredActivities.length} activities</span>
          <span>{timeRange}</span>
        </div>
      </Panel>

      <AnimatePresence>{selectedActivity && <ActivityDetailsModal activity={selectedActivity} timeFormat={timeFormat} onClose={() => setSelectedActivity(null)} />}</AnimatePresence>
    </PageMotion>
  );
}

function isRoutineActivity(activity: SystemLog) {
  return ["Login", "Logout", "Submit Enterprise Report", "Generate Final Report"].includes(activity.action);
}

function getTypeOptions(logs: SystemLog[], accountFilter: string) {
  if (accountFilter === "All Accounts") return defaultTypeOptions;
  const relevantActivities = logs.filter((activity) => activity.actorRole === accountFilter);
  const types = new Set(relevantActivities.map((activity) => activity.category));
  return ["All Types", ...Array.from(types).sort()];
}

function getAccountOptions(logs: SystemLog[], typeFilter: string) {
  if (typeFilter === "All Types") return defaultAccountOptions;
  const relevantActivities = logs.filter((activity) => activity.category === typeFilter);
  const accounts = new Set(relevantActivities.map((activity) => activity.actorRole));
  return ["All Accounts", ...Array.from(accounts).sort()];
}

function ActivityDetailsModal({ activity, timeFormat, onClose }: { activity: SystemLog; timeFormat: SystemTimeFormat; onClose: () => void }) {
  const navigate = useNavigate();
  const supportTicketId = getSupportTicketIdFromLog(activity);

  const openTicket = () => {
    if (!supportTicketId) return;
    onClose();
    navigate(`${routes.it.workCenter}?view=support&ticket=${encodeURIComponent(supportTicketId)}`);
  };

  return (
    <ModalFrame title="Activity Details" eyebrow={activity.id} onClose={onClose}>
      <ActivityDetailFields activity={activity} timeFormat={timeFormat} />
      {supportTicketId && (
        <div className="mt-5 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-700">This activity is tied to a support ticket. Open the full ticket record to inspect fields, photos, status, and conversation history.</p>
          <button
            type="button"
            onClick={openTicket}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <TicketCheck size={14} />
            Open Ticket
          </button>
        </div>
      )}
    </ModalFrame>
  );
}

export function ActivityDetailFields({ activity, timeFormat = "12-hour" }: { activity: SystemLog; timeFormat?: SystemTimeFormat }) {
  const expandableValue = (value: string, label: string) => <ExpandableTableText primary={value} ariaLabel={label} twoLines />;

  return (
    <div className="tanaw-detail-grid grid gap-4 md:grid-cols-2">
      <DetailField label="Type" value={activity.category} />
      <DetailField label="Actor" value={expandableValue(`${activity.actor} (${activity.actorRole})`, "actor")} />
      <DetailField label="Date and Time" value={formatLogTimestamp(activity.timestamp, timeFormat)} />
      <DetailField label="Target" value={expandableValue(activity.target, "target")} />
      <DetailField label="Action" value={expandableValue(activity.action, "action")} />
      <DetailField label="Summary" value={expandableValue(activity.summary, "summary")} />
    </div>
  );
}

function TypeBadge({ type }: { type: SystemLogCategory }) {
  const classes: Record<SystemLogCategory, string> = {
    "IT Activity": "bg-violet-50 text-violet-700",
    "Staff Submission": "bg-teal-50 text-teal-700",
    "Staff Operation": "bg-emerald-50 text-emerald-700",
    "Admin Operation": "bg-indigo-50 text-indigo-700",
    "Enterprise Activity": "bg-amber-50 text-amber-700",
    System: "bg-slate-100 text-slate-700",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[type]}`}>{type}</span>;
}

function formatLogTimestamp(timestamp: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(timestamp, timeFormat);
}

function getSupportTicketIdFromLog(log: SystemLog) {
  if (!log.sourceId) return null;

  const text = [log.action, log.target, log.summary, log.sourceId].join(" ").toLowerCase();
  return text.includes("ticket") || text.includes("tck-") ? log.sourceId : null;
}
