import type { QueryClient } from "@tanstack/react-query";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries/model/emailDeliveryPresentation";
import { listEmailDeliveries } from "@/features/email-deliveries/services/emailDeliveryService";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts/services/enterpriseAccountService";
import { lguAccountsQueryKey, listLguAccounts } from "@/features/lgu-accounts/services/lguAccountService";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { listActivityLogs } from "@/features/system-logs/services/activityLogService";
import { alertsQueryKey } from "@/shared/hooks/useAlerts";
import {
  operationalFinalReportsQueryKey,
  operationalMapEnterprisesQueryKey,
  operationalNotificationsQueryKey,
  operationalReportsQueryKey,
  operationalSummaryQueryKey,
} from "@/app/hooks/useOperationalSync";
import { listAlerts } from "@/shared/services/alerts";
import { getOperationalSummary, listFinalReports, listIntakeReports, listOperationalMapEnterprises, listUserNotifications } from "@/shared/services/operationalSync";
import { listReportEnterprises } from "@/shared/services/reporting";
import { listSupportTickets, supportTicketsQueryKey } from "@/shared/services/supportTickets";
import { getSystemSettings, systemSettingsQueryKey } from "@/shared/services/systemSettingsService";
import { routes } from "./routes";

type Prefetch = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };

const alerts: Prefetch = { queryKey: alertsQueryKey, queryFn: listAlerts };
const activityLogs: Prefetch = { queryKey: activityLogsQueryKey, queryFn: listActivityLogs };
const enterpriseAccounts: Prefetch = { queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts };
const lguAccounts: Prefetch = { queryKey: lguAccountsQueryKey, queryFn: listLguAccounts };
const supportTickets: Prefetch = { queryKey: supportTicketsQueryKey, queryFn: listSupportTickets };
const emailDeliveries: Prefetch = { queryKey: emailDeliveriesQueryKey, queryFn: listEmailDeliveries };
const operationalSummary: Prefetch = { queryKey: operationalSummaryQueryKey, queryFn: getOperationalSummary };
const operationalReports: Prefetch = { queryKey: operationalReportsQueryKey, queryFn: listIntakeReports };
const operationalFinalReports: Prefetch = { queryKey: operationalFinalReportsQueryKey, queryFn: listFinalReports };
const operationalMap: Prefetch = { queryKey: operationalMapEnterprisesQueryKey, queryFn: listOperationalMapEnterprises };
const operationalNotifications: Prefetch = { queryKey: operationalNotificationsQueryKey, queryFn: listUserNotifications };
const reportEnterprises: Prefetch = { queryKey: ["report-enterprises"], queryFn: listReportEnterprises };
const systemSettings: Prefetch = { queryKey: systemSettingsQueryKey, queryFn: getSystemSettings };

const prefetchesByPath: Partial<Record<string, Prefetch[]>> = {
  [routes.admin.dashboard]: [operationalMap, activityLogs, alerts, supportTickets],
  [routes.admin.enterprises]: [operationalMap, enterpriseAccounts],
  [routes.admin.reports]: [operationalReports, reportEnterprises, enterpriseAccounts, operationalMap, activityLogs, operationalFinalReports],
  [routes.admin.activity]: [activityLogs],
  [routes.admin.requests]: [alerts, enterpriseAccounts, supportTickets],
  [routes.admin.notifications]: [operationalNotifications],
  [routes.it.dashboard]: [alerts, operationalSummary, lguAccounts, enterpriseAccounts, supportTickets, emailDeliveries],
  [routes.it.enterpriseAccounts]: [enterpriseAccounts],
  [routes.it.lguAccounts]: [lguAccounts],
  [routes.it.notifications]: [operationalNotifications],
  [routes.it.systemLogs]: [activityLogs],
  [routes.it.systemSettings]: [systemSettings],
  [routes.it.workCenter]: [alerts, enterpriseAccounts, supportTickets, emailDeliveries],
  [routes.staff.reports]: [operationalReports, reportEnterprises],
  [routes.staff.consolidatedReports]: [operationalFinalReports],
  [routes.staff.notifications]: [operationalNotifications],
};

export function prefetchPortalRouteData(queryClient: QueryClient, path: string) {
  const prefetches = prefetchesByPath[path] ?? [];
  return Promise.allSettled(prefetches.map((prefetch) => queryClient.prefetchQuery(prefetch)));
}
