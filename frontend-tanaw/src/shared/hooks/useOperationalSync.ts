import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import {
  getVisitorInsights,
  getOperationalSummary,
  listFinalReports,
  listIntakeReports,
  listOperationalMapEnterprises,
  listUserNotifications,
  type VisitorInsightParams,
} from "../services/operationalSync";

export const operationalSummaryQueryKey = ["operational", "summary"];
export const operationalReportsQueryKey = ["operational", "reports", "intake"];
export const operationalFinalReportsQueryKey = ["operational", "reports", "final"];
export const operationalMapEnterprisesQueryKey = ["operational", "map-enterprises"];
export const operationalNotificationsQueryKey = ["operational", "notifications"];
export const visitorInsightsQueryKey = ["operational", "visitor-insights"];

export function useOperationalSummary() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalSummaryQueryKey, queryFn: getOperationalSummary, enabled: Boolean(token) });
}

export function useOperationalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalReportsQueryKey, queryFn: listIntakeReports, enabled: Boolean(token) });
}

export function useOperationalFinalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalFinalReportsQueryKey, queryFn: listFinalReports, enabled: Boolean(token) });
}

export function useOperationalMapEnterprises() {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: operationalMapEnterprisesQueryKey,
    queryFn: listOperationalMapEnterprises,
    enabled: Boolean(token),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
}

export function useVisitorInsights(params: VisitorInsightParams, enabled = true) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: [...visitorInsightsQueryKey, params],
    queryFn: () => getVisitorInsights(params),
    enabled: Boolean(token) && enabled,
  });
}

export function useOperationalNotifications() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalNotificationsQueryKey, queryFn: listUserNotifications, enabled: Boolean(token) });
}
