import { isEmailProblem, type EmailDelivery } from "@/features/email-deliveries";
import { isClosedRequest, type Request } from "@/shared/services/requests";
import type { AccountSummary, LiveAlert, OperationalSummary } from "@/shared/types";

type DashboardOverviewInput = {
  alerts: LiveAlert[];
  emailDeliveries: EmailDelivery[];
  enterpriseAccounts: AccountSummary[];
  lguAccounts: AccountSummary[];
  operationalSummary?: OperationalSummary;
  requests: Request[];
};

export function buildDashboardOverview(input: DashboardOverviewInput) {
  const itIssues = input.alerts;
  const open = input.requests.filter((request) => !isClosedRequest(request));
  const urgentIssueCount = open.filter((request) => request.urgent).length;
  const openSupportRequestCount = open.filter((request) => request.group !== "Account change").length;
  const pendingAccountRequestCount = open.filter((request) => request.group === "Account change").length;
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
