import { Activity, AlertTriangle, Search, ShieldCheck, TicketCheck, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { DetailField, EmptyState, ExpandableTableText, FilterSelect, ModalFrame, PageMotion, stagger } from "@/shared/components/ui";
import { useActivityLogs } from "@/shared/hooks/useActivityLogs";
import type { LogSeverity, SystemLog, SystemLogActorRole, SystemLogCategory } from "@/shared/types";
import { activityTimeRanges, isWithinActivityTimeRange } from "@/shared/utils";
import type { ActivityTimeRange } from "@/shared/utils";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type CategoryFilter = "All Categories" | SystemLogCategory;
type ActorFilter = "All Actors" | SystemLogActorRole;
type SeverityFilter = "All Severities" | LogSeverity;

const categoryFilters: CategoryFilter[] = ["All Categories", "IT Activity", "Staff Submission", "Staff Operation", "Admin Operation", "Enterprise Activity", "System"];
const actorFilters: ActorFilter[] = ["All Actors", "Admin", "IT Personnel", "LGU Staff", "Enterprise Account", "System"];
const severityFilters: SeverityFilter[] = ["All Severities", "Critical", "Warning", "Info", "Success"];

export function AdminSystemLogsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const { logs, isLoading } = useActivityLogs();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All Categories");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("All Actors");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("All Severities");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("All Time");
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);

  const sortedLogs = useMemo(() => [...logs].sort((a, b) => getTimestampValue(b.timestamp) - getTimestampValue(a.timestamp)), [logs]);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedLogs.filter((log) => {
      const searchable = [log.id, log.category, log.severity, log.actor, log.actorRole, log.action, log.target, log.summary, log.sourceId ?? ""].join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesCategory = categoryFilter === "All Categories" || log.category === categoryFilter;
      const matchesActor = actorFilter === "All Actors" || log.actorRole === actorFilter;
      const matchesSeverity = severityFilter === "All Severities" || log.severity === severityFilter;
      const matchesTimeRange = isWithinActivityTimeRange(log.timestamp, timeRange);
      return matchesQuery && matchesCategory && matchesActor && matchesSeverity && matchesTimeRange;
    });
  }, [actorFilter, categoryFilter, query, severityFilter, sortedLogs, timeRange]);

  const adminCount = logs.filter((log) => log.category === "Admin Operation").length;
  const staffCount = logs.filter((log) => log.category === "Staff Operation" || log.category === "Staff Submission").length;
  const riskCount = logs.filter((log) => log.severity === "Critical" || log.severity === "Warning").length;

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="System Logs" description="Recorded IT activity, staff submissions, admin actions, and system events." />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4" variants={stagger}>
        <MetricCard label="Total Logs" value={logs.length} foot="Recorded system activity" color="#2563eb" icon={Activity} />
        <MetricCard label="Admin Operations" value={adminCount} foot="Recorded Admin actions" color="#065f46" icon={ShieldCheck} />
        <MetricCard label="Staff Activity" value={staffCount} foot="Submissions and report actions" color="#10b981" icon={Users} />
        <MetricCard label="Warnings" value={riskCount} foot="Warning and critical logs" color="#dc2626" footClassName="text-red-600" icon={AlertTriangle} />
      </motion.section>

      <Panel className="tanaw-data-panel mt-6 overflow-hidden">
        <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, action, target, or summary"
              className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={categoryFilter} onChange={(value) => setCategoryFilter(value as CategoryFilter)} options={categoryFilters} />
          <FilterSelect value={actorFilter} onChange={(value) => setActorFilter(value as ActorFilter)} options={actorFilters} />
          <FilterSelect value={severityFilter} onChange={(value) => setSeverityFilter(value as SeverityFilter)} options={severityFilters} />
          <FilterSelect value={timeRange} onChange={(value) => setTimeRange(value as ActivityTimeRange)} options={activityTimeRanges} />
        </div>

        <div className="tanaw-data-table overflow-x-auto">
          <table className="w-full min-w-230 table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[10%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
              <tr>
                {["Date and Time", "Category", "Severity", "Actor", "Action / Target", "Summary"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
              {filteredLogs.map((log) => (
                <tr key={log.id} onClick={() => setSelectedLog(log)} className="tanaw-data-table-row group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-4 py-4 font-mono text-xs text-gray-500">{formatPhilippineDateTime(log.timestamp, timeFormat)}</td>
                  <td className="px-4 py-4">
                    <CategoryBadge category={log.category} />
                  </td>
                  <td className="px-4 py-4">
                    <SeverityBadge severity={log.severity} />
                  </td>
                  <td className="px-4 py-4">
                    <ExpandableTableText
                      primary={log.actor}
                      secondary={log.actorRole}
                      ariaLabel="actor"
                      className="font-semibold text-gray-900"
                      secondaryClassName="text-[10px] font-bold tracking-wide text-gray-500 uppercase"
                    />
                  </td>
                  <td className="px-4 py-4">
                    <ExpandableTableText primary={log.action} secondary={log.target} ariaLabel="action and target" className="font-semibold text-gray-900" secondaryClassName="text-xs text-gray-500" />
                  </td>
                  <td className="px-4 py-4 text-xs leading-relaxed text-gray-600">
                    <ExpandableTableText primary={log.summary} ariaLabel="summary" threshold={72} twoLines />
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Activity}
                      title={isLoading ? "Loading working logs" : "No working logs"}
                      description={isLoading ? "Fetching live activity records." : "Centralized audit records will appear here once system activity is recorded."}
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

      <AnimatePresence>{selectedLog && <LogDetailsModal log={selectedLog} onClose={() => setSelectedLog(null)} />}</AnimatePresence>
    </PageMotion>
  );
}

function CategoryBadge({ category }: { category: SystemLogCategory }) {
  const classes: Record<SystemLogCategory, string> = {
    "IT Activity": "border-blue-200 bg-blue-50 text-blue-700",
    "Staff Submission": "border-teal-200 bg-teal-50 text-teal-700",
    "Staff Operation": "border-emerald-200 bg-emerald-50 text-emerald-700",
    "Admin Operation": "border-indigo-200 bg-indigo-50 text-indigo-700",
    "Enterprise Activity": "border-amber-200 bg-amber-50 text-amber-700",
    System: "border-gray-200 bg-gray-100 text-gray-600",
  };
  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${classes[category]}`}>{category}</span>;
}

function SeverityBadge({ severity }: { severity: LogSeverity }) {
  const classes: Record<LogSeverity, string> = {
    Success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Info: "border-blue-200 bg-blue-50 text-blue-700",
    Warning: "border-yellow-200 bg-yellow-50 text-yellow-700",
    Critical: "border-red-200 bg-red-50 text-red-700",
  };
  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${classes[severity]}`}>{severity}</span>;
}

function LogDetailsModal({ log, onClose }: { log: SystemLog; onClose: () => void }) {
  const navigate = useNavigate();
  const supportTicketId = getSupportTicketIdFromLog(log);

  const openTicket = () => {
    if (!supportTicketId) return;
    onClose();
    navigate(`${routes.admin.supportTickets}?ticket=${encodeURIComponent(supportTicketId)}`);
  };

  return (
    <ModalFrame title="Log Details" eyebrow={log.id} onClose={onClose} maxWidthClassName="max-w-4xl">
      <AdminLogDetailFields log={log} />
      {supportTicketId && (
        <div className="mt-5 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-amber-50 p-4">
          <p className="text-sm font-semibold text-slate-700">
            This activity is tied to an enterprise support ticket. Open the supervision view to inspect the full ticket, photos, status, and IT conversation.
          </p>
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

export function AdminLogDetailFields({ log }: { log: SystemLog }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const expandableValue = (value: string, label: string) => (
    <ExpandableTableText primary={value} ariaLabel={label} threshold={72} twoLines collapsedLabel="Show more" expandedLabel="Show less" className="leading-relaxed font-semibold" />
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DetailField label="Date and Time" value={formatPhilippineDateTime(log.timestamp, timeFormat)} />
      <DetailField label="Source ID" value={log.sourceId ?? "N/A"} />
      <DetailField label="Category" value={<CategoryBadge category={log.category} />} />
      <DetailField label="Severity" value={<SeverityBadge severity={log.severity} />} />
      <DetailField label="Actor" value={expandableValue(`${log.actor} (${log.actorRole})`, "actor")} />
      <DetailField label="Action" value={expandableValue(log.action, "action")} />
      <DetailField label="Target" value={expandableValue(log.target, "target")} />
      <DetailField label="Summary" value={expandableValue(log.summary, "summary")} />
    </div>
  );
}

function getTimestampValue(timestamp: string) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}

function getSupportTicketIdFromLog(log: SystemLog) {
  if (!log.sourceId) return null;

  const text = [log.action, log.target, log.summary, log.sourceId].join(" ").toLowerCase();
  return text.includes("ticket") || text.includes("tck-") ? log.sourceId : null;
}
