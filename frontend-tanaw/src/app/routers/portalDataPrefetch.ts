import type { QueryClient } from "@tanstack/react-query";
import { listRecentEmailDeliveries } from "@/features/email-deliveries/services/emailDeliveryService";
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
} from "@/app/hooks/useOperationalSync";
import { listLiveAlerts } from "@/shared/services/alerts";
import { listFinalReports, listIntakeReports, listOperationalMapEnterprises, listUserNotifications } from "@/shared/services/operationalSync";
import { enterpriseHealthQueryKey, listEnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { listReportEnterprises } from "@/shared/services/reporting";
import { listRequests, requestsQueryKey } from "@/shared/services/requests";
import { getSystemSettings, systemSettingsQueryKey } from "@/shared/services/systemSettingsService";
import { routes } from "./routes";

type Prefetch = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };

const alerts: Prefetch = { queryKey: alertsQueryKey, queryFn: listLiveAlerts };
const activityLogs: Prefetch = { queryKey: activityLogsQueryKey, queryFn: listActivityLogs };
const enterpriseAccounts: Prefetch = { queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts };
const lguAccounts: Prefetch = { queryKey: lguAccountsQueryKey, queryFn: listLguAccounts };
const requests: Prefetch = { queryKey: requestsQueryKey, queryFn: listRequests };
const recentEmails: Prefetch = { queryKey: ["email-deliveries", "recent", 7], queryFn: () => listRecentEmailDeliveries(7) };
const enterpriseHealth: Prefetch = { queryKey: enterpriseHealthQueryKey, queryFn: listEnterpriseHealth };
const operationalReports: Prefetch = { queryKey: operationalReportsQueryKey, queryFn: listIntakeReports };
const operationalFinalReports: Prefetch = { queryKey: operationalFinalReportsQueryKey, queryFn: listFinalReports };
const operationalMap: Prefetch = { queryKey: operationalMapEnterprisesQueryKey, queryFn: listOperationalMapEnterprises };
const operationalNotifications: Prefetch = { queryKey: operationalNotificationsQueryKey, queryFn: listUserNotifications };
const reportEnterprises: Prefetch = { queryKey: ["report-enterprises"], queryFn: listReportEnterprises };
const systemSettings: Prefetch = { queryKey: systemSettingsQueryKey, queryFn: getSystemSettings };

const prefetchesByPath: Partial<Record<string, Prefetch[]>> = {
  [routes.admin.dashboard]: [operationalMap, activityLogs, alerts, requests],
  [routes.admin.enterprises]: [operationalMap, enterpriseAccounts],
  [routes.admin.reports]: [operationalReports, reportEnterprises, enterpriseAccounts, operationalMap, activityLogs, operationalFinalReports],
  [routes.admin.activity]: [activityLogs],
  [routes.admin.requests]: [requests],
  [routes.it.dashboard]: [requests, enterpriseHealth, lguAccounts, enterpriseAccounts, recentEmails],
  [routes.it.requests]: [requests, enterpriseHealth],
  [routes.it.enterprises]: [enterpriseAccounts, enterpriseHealth],
  [routes.it.personnel]: [lguAccounts],
  [routes.it.notifications]: [operationalNotifications],
  [routes.it.system]: [activityLogs, recentEmails, systemSettings],
  [routes.staff.reports]: [operationalReports, reportEnterprises],
  [routes.staff.consolidatedReports]: [operationalFinalReports],
  [routes.staff.notifications]: [operationalNotifications],
};

export function prefetchPortalRouteData(queryClient: QueryClient, path: string) {
  const prefetches = prefetchesByPath[path] ?? [];
  return Promise.allSettled(prefetches.map((prefetch) => queryClient.prefetchQuery(prefetch)));
}
