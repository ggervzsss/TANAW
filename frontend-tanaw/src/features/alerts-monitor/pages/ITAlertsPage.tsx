import { AlertTriangle, Bell, CheckCircle2, Clock3, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, FilterSelect, PageMotion } from "@/shared/components/ui";
import { alertsQueryKey, useAlerts } from "@/shared/hooks/useAlerts";
import { updateAlertStatus } from "@/shared/services/alerts";
import type { AlertSeverity, PriorityAlert, PriorityAlertStatus, PriorityAlertType } from "@/shared/types";
import { AlertDetailsModal, AlertStatusBadge, ResolutionBadge, SeverityBadge } from "../components";

type SeverityFilter = "All Severities" | AlertSeverity;
type StatusFilter = "All Statuses" | PriorityAlertStatus;
type TypeFilter = "All Types" | PriorityAlertType;

const severityFilters: SeverityFilter[] = ["All Severities", "Critical", "Warning", "Info"];
const statusFilters: StatusFilter[] = ["All Statuses", "New", "In Review", "Resolved"];
const typeFilters: TypeFilter[] = ["All Types", "Maintenance Request", "Password Reset Request", "Failed Login Threshold", "Sync Delay"];

export function ITAlertsPage() {
  const queryClient = useQueryClient();
  const { alerts: allAlerts } = useAlerts();
  const alerts = allAlerts.filter((alert) => alert.owner === "IT");
  const statusMutation = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: PriorityAlertStatus }) => updateAlertStatus(alertId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertsQueryKey }),
  });
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

  const handleStatusChange = (alert: PriorityAlert, status: PriorityAlertStatus) => {
    statusMutation.mutate({ alertId: alert.id, status });
  };

  return (
    <PageMotion>
      <PageHeader title="Alerts" description="Technical alert queue for maintenance requests, CCTV or connection issues, password resets, and account-related concerns." />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <MetricCard label="Active Alerts" value={activeAlerts.length} foot="Technical queue" color="#dc2626" footClassName="text-red-600" icon={Bell} />
        <MetricCard label="Critical" value={criticalAlerts.length} foot="Requires urgent IT action" color="#b91c1c" footClassName="text-red-600" icon={AlertTriangle} />
        <MetricCard label="In Review" value={inReviewAlerts.length} foot="Currently assigned or triaged" color="#ca8a04" footClassName="text-yellow-700" icon={Clock3} />
        <MetricCard label="Resolved" value={resolvedAlerts.length} foot="Closed by IT" color="#065f46" icon={CheckCircle2} />
      </motion.section>

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alert ID, enterprise, requester, type, or action"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={severityFilter} onChange={(value) => setSeverityFilter(value as SeverityFilter)} options={severityFilters} />
          <FilterSelect value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={statusFilters} />
          <FilterSelect value={typeFilter} onChange={(value) => setTypeFilter(value as TypeFilter)} options={typeFilters} />
        </div>

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
                {["Alert ID", "Type", "Priority", "Source", "Required Action", "Status", "IT Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} onClick={() => setSelectedAlert(alert)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
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
                    <div className="font-semibold text-gray-900">{alert.enterprise ?? alert.requester}</div>
                    <div className="mt-1 text-[10px] font-bold tracking-wide text-gray-500 uppercase">{alert.requester}</div>
                  </td>
                  <td className="px-4 py-4">
                    <p className="m-0 text-xs leading-relaxed font-semibold text-gray-700">{alert.summary}</p>
                    <p className="mt-1 mb-0 text-xs leading-relaxed text-gray-500">{alert.requiredAction}</p>
                  </td>
                  <td className="px-4 py-4">
                    <AlertStatusBadge status={alert.status} />
                    <div className="mt-2 text-[10px] font-bold tracking-wide text-gray-400 uppercase">{alert.time}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      <StatusButton disabled={alert.status === "In Review" || alert.status === "Resolved"} onClick={() => handleStatusChange(alert, "In Review")}>
                        Review
                      </StatusButton>
                      <StatusButton disabled={alert.status === "Resolved" || alert.resolutionMode === "Automatic Health Recovery"} onClick={() => handleStatusChange(alert, "Resolved")}>
                        Resolve
                      </StatusButton>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={Bell} title="No IT alerts" description="Technical alerts requiring IT attention will appear here once alert ingestion is connected." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
          <span>Showing {filteredAlerts.length} alerts</span>
          <span>{alerts.length} IT-owned alerts</span>
        </div>
      </Panel>

      <AnimatePresence>{selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}</AnimatePresence>
    </PageMotion>
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
