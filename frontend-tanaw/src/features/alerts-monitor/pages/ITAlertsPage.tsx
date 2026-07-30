import { AlertTriangle, Bell, CheckCircle2, Clock3, Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, ExpandableTableText, FilterSelect, PageMotion } from "@/shared/components/ui";
import { alertsQueryKey, useAlerts } from "@/shared/hooks/useAlerts";
import { useScopedPageState } from "@/shared/hooks/useScopedPageState";
import { sortRecommendedPriorityAlerts, updateAlertStatus } from "@/shared/services/alerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import type { PriorityAlert, PriorityAlertStatus, PriorityAlertType, TechnicalIssueUrgency } from "@/shared/types";
import { AlertDetailsModal, AlertStatusBadge, ResolutionBadge, UrgencyBadge } from "../components";

type UrgencyFilter = "All Urgencies" | TechnicalIssueUrgency;
type StatusFilter = "All Statuses" | "Needs Attention" | "Working on It" | "Resolved";
type TypeFilter = "All Types" | PriorityAlertType;
type TechnicalIssueFilters = {
  query: string;
  status: StatusFilter;
  type: TypeFilter;
  urgency: UrgencyFilter;
};

const urgencyFilters: UrgencyFilter[] = ["All Urgencies", "Urgent", "Important", "Normal"];
const statusFilters: StatusFilter[] = ["All Statuses", "Needs Attention", "Working on It", "Resolved"];
const typeFilters: TypeFilter[] = ["All Types", "Maintenance Request", "Password Reset Request", "Failed Login Threshold"];
const initialFilters: TechnicalIssueFilters = {
  query: "",
  status: "All Statuses",
  type: "All Types",
  urgency: "All Urgencies",
};

export function ITAlertsPage({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { timeFormat } = useSystemDisplayPreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const { alerts: allAlerts, isLoading } = useAlerts();
  const alerts = useMemo(() => allAlerts.filter((alert) => alert.owner === "IT"), [allAlerts]);
  const statusMutation = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: PriorityAlertStatus }) => updateAlertStatus(alertId, status),
    onMutate: async ({ alertId, status }) => {
      await queryClient.cancelQueries({ queryKey: alertsQueryKey });
      const previousAlerts = queryClient.getQueryData<PriorityAlert[]>(alertsQueryKey);
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((alert) => (alert.id === alertId ? { ...alert, status } : alert)));
      return { previousAlerts };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousAlerts) queryClient.setQueryData(alertsQueryKey, context.previousAlerts);
    },
    onSuccess: (updatedAlert) => {
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((alert) => (alert.id === updatedAlert.id ? updatedAlert : alert)));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: alertsQueryKey }),
  });
  const [filters, setFilters] = useScopedPageState<TechnicalIssueFilters>({
    initialValue: initialFilters,
    isValid: isTechnicalIssueFilters,
    namespace: "technical-issue-filters",
    version: 2,
  });
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const linkedAlertId = searchParams.get("alert");
  const selectedAlert = alerts.find((alert) => alert.id === (linkedAlertId ?? selectedAlertId)) ?? null;

  const filteredAlerts = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();
    return sortRecommendedPriorityAlerts(
      alerts.filter((alert) => {
        const searchable = [alert.id, alert.type, alert.urgency, alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, alert.status, alert.resolutionMode]
          .join(" ")
          .toLowerCase();
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchesUrgency = filters.urgency === "All Urgencies" || alert.urgency === filters.urgency;
        const matchesStatus = filters.status === "All Statuses" || itIssueStatusLabel(alert.status) === filters.status;
        const matchesType = filters.type === "All Types" || alert.type === filters.type;
        return matchesQuery && matchesUrgency && matchesStatus && matchesType;
      }),
    );
  }, [alerts, filters]);

  const activeAlerts = alerts.filter((alert) => alert.status !== "Resolved");
  const urgentAlerts = activeAlerts.filter((alert) => alert.urgency === "Urgent");
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

      <UnifiedMetricsHeader
        ariaLabel="Technical issue summary"
        metrics={[
          { id: "needs-attention", title: "Needs Attention", value: activeAlerts.length, description: "Open technical issues", tone: "danger", icon: Bell, isLoading },
          { id: "urgent", title: "Urgent", value: urgentAlerts.length, description: "Needs immediate IT action", tone: "danger", icon: AlertTriangle, isLoading },
          { id: "working", title: "Working on It", value: inReviewAlerts.length, description: "Currently being handled", tone: "warning", icon: Clock3, isLoading },
          { id: "resolved", title: "Resolved", value: resolvedAlerts.length, description: "Fixed by IT", tone: "success", icon: CheckCircle2, isLoading },
        ]}
      />

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
          <div className="relative min-w-65 flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search issue, enterprise, person, or suggested action"
              className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
            />
          </div>
          <FilterSelect value={filters.urgency} onChange={(value) => setFilters((current) => ({ ...current, urgency: value as UrgencyFilter }))} options={urgencyFilters} />
          <FilterSelect value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value as StatusFilter }))} options={statusFilters} />
          <FilterSelect value={filters.type} onChange={(value) => setFilters((current) => ({ ...current, type: value as TypeFilter }))} options={typeFilters} />
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
                <tr key={alert.id} onClick={() => openAlert(alert.id)} className="tanaw-interactive-row group cursor-pointer">
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
                    <AlertStatusBadge status={alert.status} label={itIssueStatusLabel(alert.status)} />
                    <time dateTime={alert.time} className="mt-2 block text-[10px] font-bold tracking-wide text-gray-400 uppercase">
                      {formatPhilippineDateTime(alert.time, timeFormat)}
                    </time>
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

function isTechnicalIssueFilters(value: unknown): value is TechnicalIssueFilters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TechnicalIssueFilters>;
  return (
    typeof candidate.query === "string" &&
    urgencyFilters.includes(candidate.urgency as UrgencyFilter) &&
    statusFilters.includes(candidate.status as StatusFilter) &&
    typeFilters.includes(candidate.type as TypeFilter)
  );
}
