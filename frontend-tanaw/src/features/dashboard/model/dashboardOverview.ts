import { isEmailProblem, type EmailDelivery } from "@/features/email-deliveries";
import type { AccountSummary } from "@/shared/types";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { OperationalSummary, PriorityAlert } from "@/shared/types";

type DashboardOverviewInput = {
  alerts: PriorityAlert[];
  emailDeliveries: EmailDelivery[];
  enterpriseAccounts: AccountSummary[];
  lguAccounts: AccountSummary[];
  operationalSummary?: OperationalSummary;
  supportTickets: SupportTicket[];
};

export function buildDashboardOverview(input: DashboardOverviewInput) {
  const itIssues = input.alerts.filter((alert) => alert.owner === "IT" && alert.status !== "Resolved");
  const urgentIssueCount = itIssues.filter((alert) => alert.urgency === "Urgent").length;
  const openSupportRequestCount = input.supportTickets.filter((ticket) => ticket.status !== "Resolved").length;
  const pendingAccountRequestCount = input.enterpriseAccounts.reduce((total, account) => total + account.profileChangeRequests.length, 0);
  const emailProblemCount = input.emailDeliveries.filter(isEmailProblem).length;
  const unavailableDesktopAppCount = input.operationalSummary ? input.operationalSummary.delayedGateways + input.operationalSummary.offlineGateways : 0;

  return {
    currentWorkCount: itIssues.length + openSupportRequestCount + pendingAccountRequestCount + emailProblemCount,
    emailProblemCount,
    enterpriseAccountCount: input.enterpriseAccounts.length,
    itIssueCount: itIssues.length,
    lguAccountCount: input.lguAccounts.length,
    openSupportRequestCount,
    pendingAccountRequestCount,
    summary: input.operationalSummary,
    unavailableDesktopAppCount,
    urgentIssueCount,
  };
}

export type DashboardOverview = ReturnType<typeof buildDashboardOverview> & {
  loading: {
    accounts: boolean;
    email: boolean;
    overall: boolean;
    summary: boolean;
    support: boolean;
  };
};
