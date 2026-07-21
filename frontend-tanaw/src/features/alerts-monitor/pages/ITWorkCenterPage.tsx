import { UserRoundCog } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { EnterpriseProfileRequestsPanel } from "@/features/enterprise-accounts/components";
import { isEmailProblem, ITEmailDeliveriesPage } from "@/features/email-deliveries";
import { SupportTicketsPage } from "@/features/support-tickets";
import { PageHeader } from "@/shared/components/layout";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { type AccountSummary, listEmailDeliveries, listEnterpriseAccounts } from "@/shared/services/accountManagement";
import { type SupportTicket, listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";
import { ITAlertsPage } from "./ITAlertsPage";

type WorkCenterView = "issues" | "support" | "accounts" | "email";

const EMPTY_ACCOUNTS: AccountSummary[] = [];
const EMPTY_TICKETS: SupportTicket[] = [];
const workCenterViews: { id: WorkCenterView; label: string }[] = [
  { id: "issues", label: "Technical Issues" },
  { id: "support", label: "Support Requests" },
  { id: "accounts", label: "Account Requests" },
  { id: "email", label: "Email Problems" },
];

export function ITWorkCenterPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseWorkCenterView(searchParams.get("view"));
  const highlightedAccountId = searchParams.get("account");
  const { alerts } = useAlerts();
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const supportTicketsQuery = useQuery({ queryKey: supportTicketsQueryKey, queryFn: listSupportTickets, refetchInterval: 30_000 });
  const emailDeliveriesQuery = useQuery({ queryKey: ["email-deliveries"], queryFn: listEmailDeliveries, refetchInterval: 30_000 });

  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ACCOUNTS;
  const supportTickets = supportTicketsQuery.data ?? EMPTY_TICKETS;
  const activeIssues = alerts.filter((alert) => alert.owner === "IT" && alert.status !== "Resolved");
  const activeSupportRequests = supportTickets.filter((ticket) => ticket.status !== "Resolved");
  const pendingAccountRequests = enterpriseAccounts.reduce((total, account) => total + account.profileChangeRequests.length, 0);
  const emailProblems = (emailDeliveriesQuery.data ?? []).filter(isEmailProblem);
  const viewCounts: Record<WorkCenterView, number> = {
    issues: activeIssues.length,
    support: activeSupportRequests.length,
    accounts: pendingAccountRequests,
    email: emailProblems.length,
  };

  const setView = (nextView: WorkCenterView) => {
    setSearchParams({ view: nextView });
  };

  return (
    <PageMotion className="tanaw-data-page pb-12">
      <PageHeader title="Work Center" description="See what needs attention, who is affected, and what to do next." />

      <div role="tablist" aria-label="Work Center sections" className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        {workCenterViews.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black tracking-wide uppercase transition ${
              view === item.id ? "bg-emerald-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
            }`}
          >
            {item.label}
            <span className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${view === item.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>{viewCounts[item.id]}</span>
          </button>
        ))}
      </div>

      {view === "issues" && <ITAlertsPage embedded />}
      {view === "support" && <SupportTicketsPage mode="it" embedded />}
      {view === "email" && <ITEmailDeliveriesPage embedded problemsOnly />}
      {view === "accounts" &&
        (pendingAccountRequests > 0 ? (
          <EnterpriseProfileRequestsPanel
            accounts={enterpriseAccounts}
            canResolve
            highlightedAccountId={highlightedAccountId}
            onAccountUpdated={() => void queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] })}
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <EmptyState
              icon={UserRoundCog}
              title={enterpriseAccountsQuery.isLoading ? "Checking account requests" : "No account requests"}
              description={enterpriseAccountsQuery.isLoading ? "Looking for enterprise account changes." : "There are no enterprise account changes waiting for IT review."}
            />
          </div>
        ))}
    </PageMotion>
  );
}

function parseWorkCenterView(value: string | null): WorkCenterView {
  if (value === "support" || value === "accounts" || value === "email") return value;
  return "issues";
}
