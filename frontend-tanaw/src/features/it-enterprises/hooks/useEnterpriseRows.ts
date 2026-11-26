import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts/services";
import { enterpriseHealthQueryKey, listEnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { joinEnterprises, type DisplayFormats, type EnterpriseAccount } from "../model/enterprises";

const HEALTH_REFRESH_MS = 30_000;

/** The current time, ticking every 30 seconds so "1 min ago" stays true. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The time and the system date and time formats, for the model's text helpers. */
export function useDisplayFormats(): DisplayFormats {
  const now = useNow();
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  return useMemo(() => ({ now, dateFormat, timeFormat }), [now, dateFormat, timeFormat]);
}

/** Every enterprise account joined with its desktop app health. Health refreshes every 30 seconds. */
export function useEnterpriseRows() {
  const accounts = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts });
  const health = useQuery({ queryKey: enterpriseHealthQueryKey, queryFn: listEnterpriseHealth, refetchInterval: HEALTH_REFRESH_MS });
  const rows = useMemo(() => joinEnterprises((accounts.data ?? []) as EnterpriseAccount[], health.data ?? []), [accounts.data, health.data]);
  return {
    rows,
    isLoading: accounts.isLoading,
    isError: accounts.isError,
    healthFailed: health.isError,
    refetch: () => {
      void accounts.refetch();
      void health.refetch();
    },
  };
}
