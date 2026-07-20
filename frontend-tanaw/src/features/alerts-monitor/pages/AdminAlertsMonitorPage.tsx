import { AlertTriangle, Bell, CheckCircle2, Clock3, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { EnterpriseProfileRequestsPanel } from "@/features/enterprise-accounts/components";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, ExpandableTableText, FilterSelect, PageMotion } from "@/shared/components/ui";
import { type AccountSummary, listEnterpriseAccounts } from "@/shared/services/accountManagement";
import type { AlertSeverity, PriorityAlert, PriorityAlertStatus, PriorityAlertType } from "@/shared/types";
import { AlertDetailsModal, AlertStatusBadge, ResolutionBadge, SeverityBadge } from "../components";

type SeverityFilter = "All Severities" | AlertSeverity;
type StatusFilter = "All Statuses" | PriorityAlertStatus;
type TypeFilter = "All Types" | PriorityAlertType;

const severityFilters: SeverityFilter[] = ["All Severities", "Critical", "Warning", "Info"];
const statusFilters: StatusFilter[] = ["All Statuses", "New", "In Review", "Resolved"];
const typeFilters: TypeFilter[] = [
  "All Types",
  "Maintenance Request",
  "Password Reset Request",
  "Submission Delay",
  "Threshold Breach",
  "Foot Traffic Alert",
  "Occupancy Spike",
  "Failed Login Threshold",
];
const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];

export function AdminAlertsMonitorPage() {
  const { alerts } = useAlerts();
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ENTERPRISE_ACCOUNTS;
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("All Severities");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All Statuses");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All Types");
  const [selectedAlert, setSelectedAlert] = useState<PriorityAlert | null>(null);

  const filteredAlerts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      const searchable = [alert.id, alert.type, alert.severity, alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, alert.status, alert.resolutionMode]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesSeverity = severityFilter === "All Severities" || alert.severity === severityFilter;
      const matchesStatus = statusFilter === "All Statuses" || alert.status === statusFilter;
      const matchesType = typeFilter === "All Types" || alert.type === typeFilter;
      return matchesQuery && matchesSeverity && matchesStatus && matchesType;
    });
  }, [alerts, query, severityFilter, statusFilter, typeFilter]);

  const activeAlerts = alerts.filter((alert) => alert.status !== "Resolved");
  const criticalAlerts = activeAlerts.filter((alert) => alert.severity === "Critical");
  const inReviewAlerts = alerts.filter((alert) => alert.status === "In Review");
  const resolvedAlerts = alerts.filter((alert) => alert.status === "Resolved");

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Alerts" description="Read-only system-wide alert visibility for IT requests, enterprise issues, reporting delays, occupancy spikes, and monitoring events." />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <MetricCard label="Active Alerts" value={activeAlerts.length} foot="Unresolved system-wide items" color="#dc2626" footClassName="text-red-600" icon={Bell} />
        <MetricCard label="Critical Alerts" value={criticalAlerts.length} foot="Highest priority queue" color="#b91c1c" footClassName="text-red-600" icon={AlertTriangle} />
        <MetricCard label="In Review" value={inReviewAlerts.length} foot="Currently being handled" color="#ca8a04" footClassName="text-yellow-700" icon={Clock3} />
        <MetricCard label="Resolved" value={resolvedAlerts.length} foot="Closed alert records" color="#065f46" icon={CheckCircle2} />
      </motion.section>

      <EnterpriseProfileRequestsPanel accounts={enterpriseAccounts} canResolve={false} onAccountUpdated={() => undefined} />

      <Panel className="tanaw-data-panel mt-6 overflow-hidden">
        <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alert ID, enterprise, requester, type, or action"
              className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={severityFilter} onChange={(value) => setSeverityFilter(value as SeverityFilter)} options={severityFilters} />
          <FilterSelect value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={statusFilters} />
          <FilterSelect value={typeFilter} onChange={(value) => setTypeFilter(value as TypeFilter)} options={typeFilters} />
        </div>

        <div className="tanaw-data-table overflow-x-auto">
          <table className="w-full min-w-220 table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[32%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
              <tr>
                {["Alert ID", "Type", "Priority", "Source", "Required Action", "Status"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} onClick={() => setSelectedAlert(alert)} className="tanaw-data-table-row group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-4 py-4 font-mono text-xs font-bold text-gray-600">{alert.id}</td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-gray-900">{alert.type}</div>
                    <div className="mt-1">
                      <ResolutionBadge mode={alert.resolutionMode} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <SeverityBadge severity={alert.severity} />
                  </td>
                  <td className="px-4 py-4">
                    <ExpandableTableText
                      primary={alert.enterprise ?? alert.requester}
                      secondary={alert.requester}
                      ariaLabel="alert source"
                      className="font-semibold text-gray-900"
                      secondaryClassName="text-[10px] font-bold tracking-wide text-gray-500 uppercase"
                      threshold={38}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <ExpandableTableText
                      primary={alert.summary}
                      secondary={alert.requiredAction}
                      ariaLabel="alert summary and required action"
                      className="text-xs leading-relaxed font-semibold text-gray-700"
                      secondaryClassName="text-xs leading-relaxed text-gray-500"
                      threshold={76}
                      twoLines
                    />
                  </td>
                  <td className="px-4 py-4">
                    <AlertStatusBadge status={alert.status} />
                    <div className="mt-2 text-[10px] font-bold tracking-wide text-gray-400 uppercase">{alert.time}</div>
                  </td>
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon={Bell} title="No alerts" description="System-wide alerts will appear here once monitoring and alert ingestion are connected." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="tanaw-data-footer flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {filteredAlerts.length} alerts</span>
          <span>{alerts.length} total alerts</span>
        </div>
      </Panel>

      <AnimatePresence>{selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}</AnimatePresence>
    </PageMotion>
  );
}
