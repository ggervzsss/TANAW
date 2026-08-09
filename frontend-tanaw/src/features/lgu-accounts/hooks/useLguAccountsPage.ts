import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import { resendAccountActivation, updateAccountStatus } from "@/shared/services/accountService";
import type { AccountSummary } from "@/shared/types";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { lguAccountsQueryKey, listLguAccounts } from "../services";
import type { LguRoleFilter, LguStatusFilter } from "../types";
import { filterLguAccounts } from "../utils";

const EMPTY_ACCOUNTS: AccountSummary[] = [];
export type PendingLguStatusChange = { account: AccountSummary; nextStatus: LguStatusFilter };

export function useLguAccountsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<LguRoleFilter>("all");
  const [status, setStatus] = useState<LguStatusFilter>("active");
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingLguStatusChange | null>(null);
  const [pendingActivationResend, setPendingActivationResend] = useState<AccountSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const accountsQuery = useQuery({ queryKey: lguAccountsQueryKey, queryFn: listLguAccounts });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const currentSelectedAccount = selectedAccount ? (accounts.find((account) => account.id === selectedAccount.id) ?? selectedAccount) : null;
  const filteredAccounts = useMemo(() => filterLguAccounts(accounts, query, role, status), [accounts, query, role, status]);

  const activationMutation = useMutation({
    mutationFn: (accountId: string) => resendAccountActivation(accountId),
    onSuccess: async (updatedAccount) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lguAccountsQueryKey }),
        queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }),
        queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey }),
      ]);
      toast.success("Activation email queued");
      setSelectedAccount((current) => (current?.id === updatedAccount.id ? updatedAccount : current));
      setPendingActivationResend(null);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to resend activation email")),
  });

  const statusMutation = useMutation({
    mutationFn: ({ accountId, nextStatus }: { accountId: string; nextStatus: LguStatusFilter }) => updateAccountStatus(accountId, nextStatus),
    onSuccess: async (updatedAccount, { nextStatus }) => {
      const activationEmailQueued = nextStatus === "active" && !updatedAccount.isActivated;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lguAccountsQueryKey }),
        ...(activationEmailQueued ? [queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }), queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey })] : []),
      ]);
      toast.success(activationEmailQueued ? "Account reactivated; activation email queued" : "Account status updated");
      setSelectedAccount((current) => (current?.id === updatedAccount.id ? updatedAccount : current));
      setPendingStatusChange(null);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update account status")),
  });

  return {
    accounts,
    closeActivationResend: () => setPendingActivationResend(null),
    closeCreate: () => setCreateOpen(false),
    closeSelectedAccount: () => setSelectedAccount(null),
    closeStatusChange: () => setPendingStatusChange(null),
    confirmActivationResend: () => pendingActivationResend && activationMutation.mutate(pendingActivationResend.id),
    confirmStatusChange: () => pendingStatusChange && statusMutation.mutate({ accountId: pendingStatusChange.account.id, nextStatus: pendingStatusChange.nextStatus }),
    createOpen,
    currentSelectedAccount,
    filteredAccounts,
    isActivationPending: activationMutation.isPending,
    isLoading: accountsQuery.isLoading,
    isStatusPending: statusMutation.isPending,
    openCreate: () => setCreateOpen(true),
    pendingActivationResend,
    pendingStatusChange,
    query,
    requestActivationResend: setPendingActivationResend,
    requestStatusChange: (account: AccountSummary, nextStatus: LguStatusFilter) => setPendingStatusChange({ account, nextStatus }),
    role,
    selectAccount: setSelectedAccount,
    setQuery,
    setRole,
    setStatus,
    status,
  };
}
