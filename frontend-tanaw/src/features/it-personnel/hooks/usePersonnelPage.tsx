import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactElement } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { lguAccountsQueryKey, listLguAccounts } from "@/features/lgu-accounts/services";
import { resendAccountActivation, resolveAccountEmailChangeRequest, updateAccountStatus } from "@/shared/services/accountService";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { emailChangeCallouts, filterPersonnel, personnelRoleCounts, roleLabelOf, toPersonnelAccounts, type PersonnelAccount, type PersonnelRoleFilter } from "../model";

/** A two-line toast: a bold title and a plain sentence under it. */
export function toastMessage(title: string, text: string): ReactElement {
  return (
    <>
      <span className="block font-bold">{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] font-normal">{text}</span>
    </>
  );
}

export type PersonnelSheetState = { mode: "invite" } | { mode: "edit"; accountId: string };

export function usePersonnelPage() {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<PersonnelRoleFilter>("all");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [sheet, setSheet] = useState<PersonnelSheetState | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<PersonnelAccount | null>(null);

  const accountsQuery = useQuery({ queryKey: lguAccountsQueryKey, queryFn: listLguAccounts });
  const accounts = useMemo(() => toPersonnelAccounts(accountsQuery.data ?? []), [accountsQuery.data]);
  const rows = useMemo(() => filterPersonnel(accounts, { query, role, showDeactivated }), [accounts, query, role, showDeactivated]);
  const counts = useMemo(() => personnelRoleCounts(accounts, showDeactivated), [accounts, showDeactivated]);
  const callouts = useMemo(() => emailChangeCallouts(accounts), [accounts]);
  const sheetAccount = sheet?.mode === "edit" ? (accounts.find((account) => account.id === sheet.accountId) ?? null) : null;

  const refreshAccounts = (withEmail = false) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: lguAccountsQueryKey }),
      ...(withEmail ? [queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }), queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey })] : []),
    ]);

  const resendMutation = useMutation({
    mutationFn: (account: PersonnelAccount) => resendAccountActivation(account.id),
    onSuccess: async (_updated, account) => {
      await refreshAccounts(true);
      toast.success(toastMessage("Invitation sent again", `A new link went to ${account.email}.`));
    },
    onError: (error) => toast.error(toastMessage("Invitation not sent", getApiErrorMessage(error, "The invitation could not be sent. Try again."))),
  });

  const statusMutation = useMutation({
    mutationFn: ({ account, next }: { account: PersonnelAccount; next: "active" | "inactive" }) => updateAccountStatus(account.id, next),
    onSuccess: async (updated, { account, next }) => {
      const invitationSent = next === "active" && !updated.isActivated;
      await refreshAccounts(invitationSent);
      if (next === "inactive") {
        setConfirmDeactivate(null);
        setShowDeactivated(true);
        toast.success(toastMessage(`${account.displayName} is deactivated`, "You can activate them again at any time."));
      } else if (invitationSent) {
        toast.success(toastMessage(`${account.displayName} is active again`, `They have not set a password yet, so a new invitation link went to ${account.email}.`));
      } else {
        toast.success(toastMessage(`${account.displayName} can sign in again`, `Their role stays ${roleLabelOf(account.role)}.`));
      }
    },
    onError: async (error, { next }) => {
      await refreshAccounts();
      toast.error(toastMessage(next === "inactive" ? "Not deactivated" : "Not activated", getApiErrorMessage(error, "The account could not be changed. Try again.")));
    },
  });

  const emailChangeMutation = useMutation({
    mutationFn: ({ account, action }: { account: PersonnelAccount; action: "approve" | "decline" }) => resolveAccountEmailChangeRequest(account.id, action),
    onSuccess: async (_updated, { account, action }) => {
      await refreshAccounts(true);
      toast.success(
        action === "approve"
          ? toastMessage("Email change approved", `${account.displayName} now signs in with the new email.`)
          : toastMessage("Email change declined", `The current email stays, and ${account.displayName} was told.`),
      );
    },
    onError: async (error) => {
      await refreshAccounts();
      toast.error(toastMessage("Email change not saved", getApiErrorMessage(error, "The email change could not be saved. Try again.")));
    },
  });

  const pendingAccountId = (resendMutation.isPending && resendMutation.variables?.id) || (statusMutation.isPending && statusMutation.variables?.account.id) || null;

  return {
    viewerId,
    accounts,
    rows,
    counts,
    callouts,
    isLoading: accountsQuery.isLoading,
    isError: accountsQuery.isError,
    retry: () => void accountsQuery.refetch(),
    query,
    setQuery,
    role,
    setRole,
    showDeactivated,
    setShowDeactivated,
    sheet,
    sheetAccount,
    openInvite: () => setSheet({ mode: "invite" }),
    openEdit: (account: PersonnelAccount) => setSheet({ mode: "edit", accountId: account.id }),
    closeSheet: () => setSheet(null),
    onInvited: () => {
      setSheet(null);
      setRole("all");
    },
    resend: (account: PersonnelAccount) => resendMutation.mutate(account),
    activate: (account: PersonnelAccount) => statusMutation.mutate({ account, next: "active" }),
    confirmDeactivate,
    askDeactivate: setConfirmDeactivate,
    cancelDeactivate: () => {
      if (!statusMutation.isPending) setConfirmDeactivate(null);
    },
    deactivate: () => confirmDeactivate && statusMutation.mutate({ account: confirmDeactivate, next: "inactive" }),
    isDeactivating: statusMutation.isPending && statusMutation.variables?.next === "inactive",
    pendingAccountId,
    resolveEmailChange: (accountId: string, action: "approve" | "decline") => {
      const account = accounts.find((item) => item.id === accountId);
      if (account) emailChangeMutation.mutate({ account, action });
    },
    resolvingAccountId: emailChangeMutation.isPending ? (emailChangeMutation.variables?.account.id ?? null) : null,
  };
}
