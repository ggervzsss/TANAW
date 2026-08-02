import { useQuery } from "@tanstack/react-query";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { useOperationalSummary } from "@/shared/hooks/useOperationalSync";
import { emailDeliveriesQueryKey, listEmailDeliveries } from "@/features/email-deliveries";
import { listEnterpriseAccounts, listLguAccounts } from "@/shared/services/accountManagement";
import { listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";
import { buildDashboardOverview, type DashboardOverview } from "../model";

const EMPTY_LIST: never[] = [];

export function useITDashboardOverview(): DashboardOverview {
  const { alerts, isLoading: alertsLoading } = useAlerts();
  const operationalSummaryQuery = useOperationalSummary();
  const lguAccountsQuery = useQuery({ queryKey: ["lgu-accounts"], queryFn: listLguAccounts });
  const enterpriseAccountsQuery = useQuery({ queryKey: ["enterprise-accounts"], queryFn: listEnterpriseAccounts });
  const supportTicketsQuery = useQuery({ queryKey: supportTicketsQueryKey, queryFn: listSupportTickets });
  const emailDeliveriesQuery = useQuery({ queryKey: emailDeliveriesQueryKey, queryFn: listEmailDeliveries });

  const overview = buildDashboardOverview({
    alerts,
    emailDeliveries: emailDeliveriesQuery.data ?? EMPTY_LIST,
    enterpriseAccounts: enterpriseAccountsQuery.data ?? EMPTY_LIST,
    lguAccounts: lguAccountsQuery.data ?? EMPTY_LIST,
    operationalSummary: operationalSummaryQuery.data,
    supportTickets: supportTicketsQuery.data ?? EMPTY_LIST,
  });

  return {
    ...overview,
    loading: {
      accounts: enterpriseAccountsQuery.isLoading,
      email: emailDeliveriesQuery.isLoading,
      overall: alertsLoading || operationalSummaryQuery.isLoading || supportTicketsQuery.isLoading || enterpriseAccountsQuery.isLoading || emailDeliveriesQuery.isLoading,
      summary: operationalSummaryQuery.isLoading,
      support: supportTicketsQuery.isLoading,
    },
  };
}
