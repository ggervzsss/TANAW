import { AlertTriangle, Bell, Building2, CheckCircle2, Clock3, MapPinned, RefreshCw, Search, TicketCheck, UserRoundCog } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { Link, useSearchParams } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { EnterpriseProfileRequestsPanel } from "@/features/enterprise-accounts/components";
import { PriorityBadge, TicketDetailsModal, TicketStatusBadge } from "@/features/support-tickets";
import { MetricCard } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { alertsQueryKey, useAlerts } from "@/shared/hooks/useAlerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { type AccountSummary, listEnterpriseAccounts } from "@/shared/services/accountManagement";
import { updateAlertStatus } from "@/shared/services/alerts";
import { type SupportTicket, listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { DetailField, EmptyState, ExpandableTableText, ModalFrame, PageMotion } from "@/shared/components/ui";
import { AlertStatusBadge, SeverityBadge } from "../components";

type OperationsView = "situations" | "support" | "accounts";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_SUPPORT_TICKETS: SupportTicket[] = [];
const operationsViews: { id: OperationsView; label: string }[] = [
  { id: "situations", label: "Needs Attention" },
  { id: "support", label: "Escalated Support" },
  { id: "accounts", label: "Account Requests" },
];

export function AdminOperationsCenterPage() {
  const { alerts, isLoading: alertsLoading } = useAlerts();
  const { timeFormat } = useSystemDisplayPreferences();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const view = parseOperationsView(searchParams.get("view"));
  const linkedAlertId = searchParams.get("alert");
  const linkedTicketId = searchParams.get("ticket");

  const enterpriseAccountsQuery = useQuery({
    queryKey: ["enterprise-accounts"],
    queryFn: listEnterpriseAccounts,
  });
  const supportTicketsQuery = useQuery({
    queryKey: supportTicketsQueryKey,
    queryFn: listSupportTickets,
    refetchInterval: 30_000,
  });

  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ENTERPRISE_ACCOUNTS;
  const supportTickets = supportTicketsQuery.data ?? EMPTY_SUPPORT_TICKETS;
  const selectedAlert = alerts.find((alert) => alert.id === (linkedAlertId ?? selectedAlertId)) ?? null;
  const pendingAccountRequests = enterpriseAccounts.reduce((total, account) => total + account.profileChangeRequests.length, 0);
  const activeSituations = alerts.filter((alert) => alert.status !== "Resolved");
  const busyEstablishments = activeSituations.filter((alert) => isCrowdSituation(alert));
  const activeSupportRequests = supportTickets.filter((ticket) => ticket.status !== "Resolved");

  const filteredAlerts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      const searchable = [adminAlertLabel(alert), alert.enterprise ?? "", alert.requester, alert.summary, alert.requiredAction, adminAlertStatusLabel(alert.status)].join(" ").toLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery);
    });
  }, [alerts, query]);

  const filteredSupportTickets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return supportTickets.filter((ticket) => {
      const searchable = [ticket.code, ticket.enterpriseName, ticket.subject, ticket.description, ticket.category, ticket.priority, ticket.status].join(" ").toLowerCase();
      return !normalizedQuery || searchable.includes(normalizedQuery);
    });
  }, [query, supportTickets]);

  const setView = (nextView: OperationsView) => {
    const nextParams = new URLSearchParams();
    nextParams.set("view", nextView);
    setSearchParams(nextParams);
    setQuery("");
    setSelectedAlertId(null);
  };

  const openAlert = (alertId: string) => {
    setSelectedAlertId(alertId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", "situations");
    nextParams.delete("ticket");
    nextParams.set("alert", alertId);
    setSearchParams(nextParams, { replace: true });
  };

  const closeAlert = () => {
    setSelectedAlertId(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("alert");
    setSearchParams(nextParams, { replace: true });
  };

  const closeTicket = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("ticket");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader
        title="Operations Center"
        description="Review situations that need an Admin decision, important support requests, and pending account changes."
        action={
          <Link
            to={routes.admin.mapview}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <MapPinned size={15} />
            Open Live Map
          </Link>
        }
      />

      <motion.section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <MetricCard label="Needs Attention" value={activeSituations.length} foot="Current Admin situations" color="#dc2626" footClassName="text-red-600" icon={Bell} />
        <MetricCard label="Busy Establishments" value={busyEstablishments.length} foot="Higher activity than usual" color="#b45309" footClassName="text-amber-700" icon={Building2} />
        <MetricCard label="Escalated Support" value={activeSupportRequests.length} foot="High or urgent requests" color="#2563eb" footClassName="text-blue-700" icon={TicketCheck} />
        <MetricCard label="Account Requests" value={pendingAccountRequests} foot="Waiting for IT review" color="#0f766e" icon={UserRoundCog} />
      </motion.section>

      <Panel className="tanaw-data-panel mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 p-3">
          {operationsViews.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-full px-4 py-2 text-xs font-black tracking-wide uppercase transition ${
                view === item.id ? "bg-emerald-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {view !== "accounts" && (
          <div className="tanaw-data-toolbar flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
            <div className="relative min-w-65 flex-1">
              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={view === "situations" ? "Search establishment, situation, or suggested response" : "Search enterprise, request, category, or status"}
                className="tanaw-data-search focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 transition outline-none focus:ring-1"
              />
            </div>
            <button
              type="button"
              onClick={() => void (view === "situations" ? queryClient.invalidateQueries({ queryKey: alertsQueryKey }) : supportTicketsQuery.refetch())}
              className="tanaw-data-refresh inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs font-black tracking-wide text-emerald-700 uppercase shadow-sm transition hover:bg-emerald-50"
            >
              <RefreshCw size={14} className={alertsLoading || supportTicketsQuery.isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        )}

        {view === "situations" && <SituationTable alerts={filteredAlerts} isLoading={alertsLoading} onOpen={openAlert} />}
        {view === "support" && (
          <SupportRequestTable tickets={filteredSupportTickets} isLoading={supportTicketsQuery.isLoading} onOpen={(ticketId) => setSearchParams({ view: "support", ticket: ticketId })} />
        )}
        {view === "accounts" && (
          <div className="p-5">
            {pendingAccountRequests > 0 ? (
              <EnterpriseProfileRequestsPanel accounts={enterpriseAccounts} canResolve={false} onAccountUpdated={() => undefined} />
            ) : (
              <EmptyState
                icon={UserRoundCog}
                title={enterpriseAccountsQuery.isLoading ? "Loading account requests" : "No pending account requests"}
                description={enterpriseAccountsQuery.isLoading ? "Checking enterprise account changes." : "IT has no enterprise profile changes waiting for review."}
              />
            )}
          </div>
        )}
      </Panel>

      <AnimatePresence>
        {selectedAlert && <AdminSituationDetailsModal alert={selectedAlert} onClose={closeAlert} />}
        {linkedTicketId && <TicketDetailsModal mode="admin" ticketId={linkedTicketId} timeFormat={timeFormat} onClose={closeTicket} />}
      </AnimatePresence>
    </PageMotion>
  );
}

function SituationTable({ alerts, isLoading, onOpen }: { alerts: PriorityAlert[]; isLoading: boolean; onOpen: (alertId: string) => void }) {
  return (
    <>
      <div className="tanaw-data-table overflow-x-auto">
        <table className="w-full min-w-220 table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[34%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Situation", "Establishment", "What Happened", "Urgency", "Status"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
            {alerts.map((alert) => (
              <tr key={alert.id} onClick={() => onOpen(alert.id)} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
                <td className="px-4 py-4 font-bold text-gray-950">{adminAlertLabel(alert)}</td>
                <td className="px-4 py-4">
                  <ExpandableTableText primary={alert.enterprise ?? alert.requester} ariaLabel="affected establishment" className="font-semibold text-gray-900" />
                </td>
                <td className="px-4 py-4">
                  <ExpandableTableText primary={alert.summary} secondary={alert.requiredAction} ariaLabel="situation and suggested response" twoLines />
                </td>
                <td className="px-4 py-4">
                  <AdminUrgencyBadge alert={alert} />
                </td>
                <td className="px-4 py-4">
                  <AdminAlertStatusBadge status={alert.status} />
                </td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={CheckCircle2}
                    title={isLoading ? "Loading current situations" : "No situations found"}
                    description={isLoading ? "Checking current Admin situations." : "There are no Admin situations matching this search."}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tanaw-data-footer border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">Showing {alerts.length} Admin situations</div>
    </>
  );
}

function SupportRequestTable({ tickets, isLoading, onOpen }: { tickets: SupportTicket[]; isLoading: boolean; onOpen: (ticketId: string) => void }) {
  return (
    <>
      <div className="tanaw-data-table overflow-x-auto">
        <table className="w-full min-w-210 table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[17%]" />
            <col className="w-[22%]" />
            <col className="w-[35%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Request", "Enterprise", "Concern", "Urgency", "Status"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
            {tickets.map((ticket) => (
              <tr key={ticket.id} onClick={() => onOpen(ticket.id)} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
                <td className="px-4 py-4 font-mono text-xs font-bold text-emerald-700">{ticket.code}</td>
                <td className="px-4 py-4 font-bold text-gray-950">{ticket.enterpriseName}</td>
                <td className="px-4 py-4">
                  <ExpandableTableText primary={ticket.subject} secondary={ticket.description} ariaLabel="support concern" twoLines />
                </td>
                <td className="px-4 py-4">
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="px-4 py-4">
                  <TicketStatusBadge status={ticket.status} />
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={TicketCheck}
                    title={isLoading ? "Loading escalated support" : "No escalated support requests"}
                    description={isLoading ? "Checking important enterprise requests." : "High and urgent requests that need Admin awareness will appear here."}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tanaw-data-footer border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
        IT handles responses; Admin has supervisory visibility
      </div>
    </>
  );
}

function AdminSituationDetailsModal({ alert, onClose }: { alert: PriorityAlert; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { timeFormat } = useSystemDisplayPreferences();
  const statusMutation = useMutation({
    mutationFn: (status: PriorityAlertStatus) => updateAlertStatus(alert.id, status),
    onSuccess: async (updatedAlert) => {
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((item) => (item.id === updatedAlert.id ? updatedAlert : item)));
      await queryClient.invalidateQueries({ queryKey: alertsQueryKey });
      toast.success(`Situation marked as ${adminAlertStatusLabel(updatedAlert.status).toLowerCase()}.`);
    },
    onError: () => toast.error("Unable to update this situation. Please try again."),
  });

  return (
    <ModalFrame title={adminAlertLabel(alert)} eyebrow="Admin Situation" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-2">
        <DetailField label="Establishment" value={alert.enterprise ?? alert.requester} />
        <DetailField label="Date and Time" value={formatPhilippineDateTime(alert.time, timeFormat)} />
        <DetailField label="Urgency" value={<AdminUrgencyBadge alert={alert} />} />
        <DetailField label="Status" value={<AdminAlertStatusBadge status={alert.status} />} />
        <DetailField label="What Happened" value={alert.summary} />
        <DetailField label="Suggested Response" value={alert.requiredAction} />
      </div>

      <div className="tanaw-modal-action-panel mt-5 rounded-2xl border p-4 shadow-sm">
        <p className="tanaw-modal-action-panel__title text-sm font-black">Record the Admin response</p>
        <p className="tanaw-modal-action-panel__copy mt-1 text-xs font-semibold">This updates the situation for other Admin accounts and records the action in Activity History.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {alert.status !== "In Review" && alert.status !== "Resolved" && (
            <StatusButton label="Start Review" icon={Clock3} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("In Review")} />
          )}
          {alert.status !== "Resolved" && <StatusButton label="Mark Resolved" icon={CheckCircle2} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("Resolved")} />}
          {alert.status === "Resolved" && <StatusButton label="Reopen" icon={AlertTriangle} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("New")} />}
        </div>
      </div>
    </ModalFrame>
  );
}

function StatusButton({ disabled, icon: Icon, label, onClick }: { disabled: boolean; icon: typeof Clock3; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function AdminAlertStatusBadge({ status }: { status: PriorityAlertStatus }) {
  return <AlertStatusBadge status={status} label={adminAlertStatusLabel(status)} />;
}

function AdminUrgencyBadge({ alert }: { alert: PriorityAlert }) {
  const labels = {
    Critical: "Urgent",
    Warning: "Important",
    Info: "For Awareness",
  } as const;
  return <SeverityBadge severity={alert.severity} label={labels[alert.severity]} />;
}

function adminAlertStatusLabel(status: PriorityAlertStatus) {
  if (status === "New") return "Needs Attention";
  if (status === "In Review") return "Being Reviewed";
  return "Resolved";
}

function adminAlertLabel(alert: PriorityAlert) {
  const labels: Partial<Record<PriorityAlert["type"], string>> = {
    "Foot Traffic Alert": "Busy Establishment",
    "Occupancy Spike": "Sudden Crowd Increase",
    "Submission Delay": "Late Enterprise Report",
  };
  return labels[alert.type] ?? alert.type;
}

function isCrowdSituation(alert: PriorityAlert) {
  return ["Foot Traffic Alert", "Occupancy Spike"].includes(alert.type);
}

function parseOperationsView(value: string | null): OperationsView {
  if (value === "support" || value === "accounts") return value;
  return "situations";
}
