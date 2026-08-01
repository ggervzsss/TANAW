import { Bell, Building2, MapPinned, Search, TicketCheck, UserRoundCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { EnterpriseProfileRequestsPanel } from "@/features/enterprise-accounts/components";
import { TicketDetailsModal } from "@/features/support-tickets";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { type AccountSummary, listEnterpriseAccounts } from "@/shared/services/accountManagement";
import { type SupportTicket, listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { AdminSituationDetailsModal, SituationTable, SupportRequestTable } from "../components";
import { filterAdminAlerts, filterAdminSupportTickets, isCrowdSituation, operationsViews, parseOperationsView, type OperationsView } from "../model";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_SUPPORT_TICKETS: SupportTicket[] = [];
export function AdminOperationsCenterPage() {
  const { alerts, isLoading: alertsLoading } = useAlerts();
  const { timeFormat } = useSystemDisplayPreferences();
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
  });

  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ENTERPRISE_ACCOUNTS;
  const supportTickets = supportTicketsQuery.data ?? EMPTY_SUPPORT_TICKETS;
  const selectedAlert = alerts.find((alert) => alert.id === (linkedAlertId ?? selectedAlertId)) ?? null;
  const pendingAccountRequests = enterpriseAccounts.reduce((total, account) => total + account.profileChangeRequests.length, 0);
  const activeSituations = alerts.filter((alert) => alert.status !== "Resolved");
  const busyEstablishments = activeSituations.filter((alert) => isCrowdSituation(alert));
  const activeSupportRequests = supportTickets.filter((ticket) => ticket.status !== "Resolved");

  const filteredAlerts = useMemo(() => filterAdminAlerts(alerts, query), [alerts, query]);
  const filteredSupportTickets = useMemo(() => filterAdminSupportTickets(supportTickets, query), [query, supportTickets]);

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

      <UnifiedMetricsHeader
        ariaLabel="Operations Center summary"
        metrics={[
          {
            id: "needs-attention",
            title: "Needs Attention",
            value: activeSituations.length,
            description: "Current Admin situations",
            tone: "danger",
            icon: Bell,
            isLoading: alertsLoading,
          },
          {
            id: "busy-establishments",
            title: "Busy Establishments",
            value: busyEstablishments.length,
            description: "Higher activity than usual",
            tone: "warning",
            icon: Building2,
            isLoading: alertsLoading,
          },
          {
            id: "escalated-support",
            title: "Escalated Support",
            value: activeSupportRequests.length,
            description: "High or urgent requests",
            tone: "info",
            icon: TicketCheck,
            isLoading: supportTicketsQuery.isLoading,
          },
          {
            id: "account-requests",
            title: "Account Requests",
            value: pendingAccountRequests,
            description: "Waiting for IT review",
            tone: "teal",
            icon: UserRoundCog,
            isLoading: enterpriseAccountsQuery.isLoading,
          },
        ]}
      />

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
