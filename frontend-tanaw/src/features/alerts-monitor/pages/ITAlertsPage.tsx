import { AlertTriangle, Bell, CheckCircle2, Clock3, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, ExpandableTableText, FilterSelect, PageMotion } from "@/shared/components/ui";
import { alertsQueryKey, useAlerts } from "@/shared/hooks/useAlerts";
import { updateAlertStatus } from "@/shared/services/alerts";
import type { AlertSeverity, PriorityAlert, PriorityAlertStatus, PriorityAlertType } from "@/shared/types";
import { AlertDetailsModal, AlertStatusBadge, ResolutionBadge, SeverityBadge } from "../components";

type SeverityFilter = "All Severities" | AlertSeverity;
type StatusFilter = "All Statuses" | "Needs Attention" | "Working on It" | "Resolved";
type TypeFilter = "All Types" | PriorityAlertType;

const severityFilters: SeverityFilter[] = ["All Severities", "Critical", "Warning", "Info"];
const statusFilters: StatusFilter[] = ["All Statuses", "Needs Attention", "Working on It", "Resolved"];
const typeFilters: TypeFilter[] = ["All Types", "Maintenance Request", "Password Reset Request", "Failed Login Threshold"];

export function ITAlertsPage({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const linkedAlertId = searchParams.get("alert");
  const selectedAlert = alerts.find((alert) => alert.id === (linkedAlertId ?? selectedAlertId)) ?? null;

  const filteredAlerts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      const searchable = [alert.id, alert.type, alert.severity, alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, alert.status, alert.resolutionMode]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesSeverity = severityFilter === "All Severities" || alert.severity === severityFilter;
      const matchesStatus = statusFilter === "All Statuses" || itIssueStatusLabel(alert.status) === statusFilter;
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

  const openAlert = (alertId: string) => {
    setSelectedAlertId(alertId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", "issues");
    nextParams.set("alert", alertId);
    setSearchParams(nextParams, { replace: true });
  };

  const closeAlert = () => {
    setSelectedAlertId(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("alert");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <PageMotion>
      {!embedded && <PageHeader title="Technical Issues" description="Problems with cameras, desktop applications, data updates, sign-ins, and account access that may need IT action." />}

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <MetricCard label="Needs Attention" value={activeAlerts.length} foot="Open technical issues" color="#dc2626" footClassName="text-red-600" icon={Bell} />
        <MetricCard label="Urgent" value={criticalAlerts.length} foot="Needs immediate IT action" color="#b91c1c" footClassName="text-red-600" icon={AlertTriangle} />
        <MetricCard label="Working on It" value={inReviewAlerts.length} foot="Currently being handled" color="#ca8a04" footClassName="text-yellow-700" icon={Clock3} />
        <MetricCard label="Resolved" value={resolvedAlerts.length} foot="Fixed by IT" color="#065f46" icon={CheckCircle2} />
      </motion.section>

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search issue, enterprise, person, or suggested action"
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
                {["Issue ID", "Problem", "Urgency", "Affected Account", "What to Do", "Status", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-4 whitespace-nowrap">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} onClick={() => openAlert(alert.id)} className="group hover:bg-tgreen-dark/5 cursor-pointer transition">
                  <td className="px-4 py-4 font-mono text-xs font-bold text-gray-600">{alert.id}</td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-gray-900">{alert.type}</div>
                    <div className="mt-1">
                      <ResolutionBadge mode={alert.resolutionMode} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <SeverityBadge severity={alert.severity} label={itUrgencyLabel(alert.severity)} />
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
                    <AlertStatusBadge status={alert.status} label={itIssueStatusLabel(alert.status)} />
                    <div className="mt-2 text-[10px] font-bold tracking-wide text-gray-400 uppercase">{alert.time}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      <StatusButton disabled={alert.status === "In Review" || alert.status === "Resolved"} onClick={() => handleStatusChange(alert, "In Review")}>
                        Start Work
                      </StatusButton>
                      <StatusButton disabled={alert.status === "Resolved"} onClick={() => handleStatusChange(alert, "Resolved")}>
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
      </Panel>

      <AnimatePresence>{selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={closeAlert} />}</AnimatePresence>
    </PageMotion>
  );
}

function itIssueStatusLabel(status: PriorityAlertStatus) {
  if (status === "New") return "Needs Attention";
  if (status === "In Review") return "Working on It";
  return "Resolved";
}

function itUrgencyLabel(severity: AlertSeverity) {
  if (severity === "Critical") return "Urgent";
  if (severity === "Warning") return "Important";
  return "For Awareness";
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
