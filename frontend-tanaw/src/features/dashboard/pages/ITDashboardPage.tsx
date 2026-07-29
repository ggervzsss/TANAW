import { AlertTriangle, Building2, CheckCircle2, ChevronRight, Inbox, TicketCheck, UserRoundCog, Users, WifiOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { isEmailProblem } from "@/features/email-deliveries";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { useOperationalSummary } from "@/shared/hooks/useOperationalSync";
import { listEmailDeliveries, listEnterpriseAccounts, listLguAccounts } from "@/shared/services/accountManagement";
import { listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";

export function ITDashboardPage() {
  const { alerts, isLoading: alertsLoading } = useAlerts();
  const operationalSummaryQuery = useOperationalSummary();
  const lguAccountsQuery = useQuery({ queryKey: ["lgu-accounts"], queryFn: listLguAccounts });
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const supportTicketsQuery = useQuery({ queryKey: supportTicketsQueryKey, queryFn: listSupportTickets });
  const emailDeliveriesQuery = useQuery({ queryKey: ["email-deliveries"], queryFn: listEmailDeliveries });

  const itIssues = alerts.filter((alert) => alert.owner === "IT" && alert.status !== "Resolved");
  const urgentIssues = itIssues.filter((alert) => alert.urgency === "Urgent");
  const openSupportRequests = (supportTicketsQuery.data ?? []).filter((ticket) => ticket.status !== "Resolved");
  const pendingAccountRequests = (enterpriseAccountsQuery.data ?? []).reduce((total, account) => total + account.profileChangeRequests.length, 0);
  const emailProblems = (emailDeliveriesQuery.data ?? []).filter(isEmailProblem);
  const summary = operationalSummaryQuery.data;
  const unavailableDesktopApps = summary ? summary.delayedGateways + summary.offlineGateways : 0;
  const isLoading = alertsLoading || operationalSummaryQuery.isLoading || supportTicketsQuery.isLoading || enterpriseAccountsQuery.isLoading || emailDeliveriesQuery.isLoading;
  const currentWorkCount = itIssues.length + openSupportRequests.length + pendingAccountRequests + emailProblems.length;

  return (
    <PageMotion className="pb-12">
      <PageHeader title="Overview" description="A simple view of the technical work that needs attention now." />

      <UnifiedMetricsHeader
        ariaLabel="IT operations overview"
        metrics={[
          {
            id: "urgent-issues",
            title: "Urgent Issues",
            value: urgentIssues.length,
            description: "Needs immediate action",
            tone: "danger",
            icon: AlertTriangle,
            isLoading,
          },
          {
            id: "desktop-apps",
            title: "Desktop Apps",
            value: unavailableDesktopApps,
            description: "Offline or delayed",
            tone: "warning",
            icon: WifiOff,
            isLoading: operationalSummaryQuery.isLoading && !summary,
          },
          {
            id: "support-requests",
            title: "Support Requests",
            value: openSupportRequests.length,
            description: "Open enterprise requests",
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
          {
            id: "email-problems",
            title: "Email Problems",
            value: emailProblems.length,
            description: "Failed or uncertain",
            tone: "purple",
            icon: Inbox,
            isLoading: emailDeliveriesQuery.isLoading,
          },
        ]}
      />

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Current Work</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Open a group to see what happened and what to do next.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{currentWorkCount} open</span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            <WorkItem
              icon={AlertTriangle}
              label="Technical Issues"
              count={itIssues.length}
              description={
                urgentIssues.length > 0
                  ? `${urgentIssues.length} urgent ${urgentIssues.length === 1 ? "issue needs" : "issues need"} immediate attention.`
                  : "Camera, desktop application, and data update problems."
              }
              href={`${routes.it.workCenter}?view=issues`}
              urgent={urgentIssues.length > 0}
            />
            <WorkItem
              icon={TicketCheck}
              label="Support Requests"
              count={openSupportRequests.length}
              description="Questions and problems sent by enterprises."
              href={`${routes.it.workCenter}?view=support`}
            />
            <WorkItem icon={UserRoundCog} label="Account Requests" count={pendingAccountRequests} description="Enterprise details waiting for review." href={`${routes.it.workCenter}?view=accounts`} />
            <WorkItem icon={Inbox} label="Email Problems" count={emailProblems.length} description="Emails that failed or need a provider check." href={`${routes.it.workCenter}?view=email`} />
          </div>
        </Panel>

        <div className="grid content-start gap-6">
          <Panel className="p-6">
            <div className="flex items-start gap-3">
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${unavailableDesktopApps > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                {unavailableDesktopApps > 0 ? <WifiOff size={21} /> : <CheckCircle2 size={21} />}
              </span>
              <div>
                <h2 className="font-black text-slate-950">Desktop Application Status</h2>
                <p className="mt-1 text-sm leading-6 font-medium text-slate-600">
                  {summary
                    ? `${summary.onlineGateways} online, ${summary.delayedGateways} delayed, and ${summary.offlineGateways} offline.`
                    : "Desktop application status will appear when enterprise updates are available."}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-black text-slate-950">Account Directory</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Account totals are kept here as reference, not as urgent work.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DirectoryCount icon={Users} label="LGU Personnel" value={lguAccountsQuery.data?.length ?? 0} />
              <DirectoryCount icon={Building2} label="Enterprises" value={enterpriseAccountsQuery.data?.length ?? 0} />
            </div>
            <Link to={routes.it.lguAccounts} className="mt-4 inline-flex items-center gap-1 text-sm font-black text-emerald-700 hover:text-emerald-800">
              Open Accounts <ChevronRight size={16} />
            </Link>
          </Panel>
        </div>
      </div>
    </PageMotion>
  );
}

function WorkItem({ icon: Icon, label, count, description, href, urgent = false }: { icon: typeof AlertTriangle; label: string; count: number; description: string; href: string; urgent?: boolean }) {
  return (
    <Link to={href} className="tanaw-interactive-row group flex items-center gap-4 px-6 py-5">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${urgent ? "bg-red-100 text-red-700" : "tanaw-work-item-icon bg-slate-100 text-slate-600"}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-black text-slate-950">{label}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ${urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>{count}</span>
        </span>
        <span className="mt-1 block text-sm font-medium text-slate-500">{description}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" />
    </Link>
  );
}

function DirectoryCount({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <Icon size={16} className="text-emerald-700" />
      <p className="mt-2 text-xl font-black text-slate-950">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
    </div>
  );
}
