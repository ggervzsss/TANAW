import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { alertsQueryKey, useAlerts } from "@/shared/hooks/useAlerts";
import { useScopedPageState } from "@/shared/hooks/useScopedPageState";
import { updateAlertStatus } from "@/shared/services/alerts";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { filterTechnicalIssues, initialTechnicalIssueFilters, isTechnicalIssueFilters, type TechnicalIssueFilters } from "../model";

export function useTechnicalIssuesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { alerts: allAlerts, isLoading } = useAlerts();
  const alerts = useMemo(() => allAlerts.filter((alert) => alert.owner === "IT"), [allAlerts]);
  const [filters, setFilters] = useScopedPageState<TechnicalIssueFilters>({
    initialValue: initialTechnicalIssueFilters,
    isValid: isTechnicalIssueFilters,
    namespace: "technical-issue-filters",
    version: 2,
  });
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const selectedAlert = alerts.find((alert) => alert.id === (searchParams.get("alert") ?? selectedAlertId)) ?? null;
  const filteredAlerts = useMemo(() => filterTechnicalIssues(alerts, filters), [alerts, filters]);

  const statusMutation = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: PriorityAlertStatus }) => updateAlertStatus(alertId, status),
    onMutate: async ({ alertId, status }) => {
      await queryClient.cancelQueries({ queryKey: alertsQueryKey });
      const previousAlerts = queryClient.getQueryData<PriorityAlert[]>(alertsQueryKey);
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((alert) => (alert.id === alertId ? { ...alert, status } : alert)));
      return { previousAlerts };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousAlerts) queryClient.setQueryData(alertsQueryKey, context.previousAlerts);
    },
    onSuccess: (updatedAlert) => {
      queryClient.setQueryData<PriorityAlert[]>(alertsQueryKey, (current = []) => current.map((alert) => (alert.id === updatedAlert.id ? updatedAlert : alert)));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: alertsQueryKey }),
  });

  function openAlert(alertId: string) {
    setSelectedAlertId(alertId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", "issues");
    nextParams.set("alert", alertId);
    setSearchParams(nextParams, { replace: true });
  }

  function closeAlert() {
    setSelectedAlertId(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("alert");
    setSearchParams(nextParams, { replace: true });
  }

  return {
    alerts,
    closeAlert,
    filteredAlerts,
    filters,
    isLoading,
    openAlert,
    selectedAlert,
    setFilters,
    updateStatus: (alert: PriorityAlert, status: PriorityAlertStatus) => statusMutation.mutate({ alertId: alert.id, status }),
  };
}
