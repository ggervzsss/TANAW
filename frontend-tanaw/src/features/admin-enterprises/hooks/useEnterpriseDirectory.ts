import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useOperationalMapEnterprises } from "@/app/hooks/useOperationalSync";
import { useAuthStore } from "@/app/store/authStore";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts/services";
import { buildEnterpriseRows } from "../model/enterpriseDirectory";

/** The current time, refreshed every `intervalMs`, so "since" and "ago" text stays current. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Monitored enterprises joined with their accounts. The list waits for the monitoring data (camera
 * status is the point of the screen); the accounts only add classification and address, so a failed
 * accounts request still shows the list.
 */
export function useEnterpriseDirectory(now: Date) {
  const token = useAuthStore((state) => state.token);
  const mapQuery = useOperationalMapEnterprises();
  const accountsQuery = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts, enabled: Boolean(token) });
  const accountsSettled = !accountsQuery.isPending || accountsQuery.isError;

  const rows = useMemo(
    () => (mapQuery.data && accountsSettled ? buildEnterpriseRows(mapQuery.data, accountsQuery.data ?? [], now) : []),
    [mapQuery.data, accountsQuery.data, accountsSettled, now],
  );

  return {
    rows,
    isLoading: mapQuery.isPending || !accountsSettled,
    isError: mapQuery.isError,
    accountsFailed: accountsQuery.isError,
    updatedAt: mapQuery.dataUpdatedAt,
    isFetching: mapQuery.isFetching,
    refetch: () => {
      void mapQuery.refetch();
      if (accountsQuery.isError) void accountsQuery.refetch();
    },
  };
}
