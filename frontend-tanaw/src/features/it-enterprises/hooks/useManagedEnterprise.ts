import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { enterpriseAccountsQueryKey } from "@/features/enterprise-accounts/services";
import { enterpriseHealthDetailQueryKey, getEnterpriseHealth } from "@/shared/services/enterpriseHealth";
import { joinEnterprises, type EnterpriseAccount } from "../model/enterprises";
import { enterpriseAccountQueryKey, getEnterpriseAccount, isNotFound } from "../services/itEnterpriseService";

const HEALTH_REFRESH_MS = 30_000;

/** One enterprise, by the enterprise ID (or account ID) in the address, with its health. */
export function useManagedEnterprise(reference: string) {
  const queryClient = useQueryClient();
  const accountKey = enterpriseAccountQueryKey(reference);
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => getEnterpriseAccount(reference),
    enabled: Boolean(reference),
    retry: (count, error) => !isNotFound(error) && count < 2,
    // The list may already hold this account; show it while the fresh copy loads.
    placeholderData: () => queryClient.getQueryData<EnterpriseAccount[]>(enterpriseAccountsQueryKey)?.find((item) => item.enterpriseId === reference || item.id === reference),
  });
  const health = useQuery({
    queryKey: enterpriseHealthDetailQueryKey(reference),
    queryFn: () => getEnterpriseHealth(reference),
    enabled: Boolean(reference),
    refetchInterval: HEALTH_REFRESH_MS,
    retry: (count, error) => !isNotFound(error) && count < 2,
  });

  const row = useMemo(() => (account.data ? (joinEnterprises([account.data], health.data ? [health.data] : [])[0] ?? null) : null), [account.data, health.data]);

  const setAccount = useCallback((next: EnterpriseAccount) => queryClient.setQueryData(accountKey, next), [queryClient, accountKey]);

  return {
    row,
    isLoading: account.isLoading,
    notFound: !reference || (account.isError && isNotFound(account.error)),
    isError: account.isError && !isNotFound(account.error),
    refetch: () => {
      void account.refetch();
      void health.refetch();
    },
    setAccount,
  };
}
