import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound } from "lucide-react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { ModalFrame, PageMotion } from "@/shared/components/ui";
import { type AccountSummary, listLguAccounts, resendAccountActivation, updateAccountStatus } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { CreateLguAccountModal, LguAccountDetailsModal, LguAccountsMetrics, LguAccountsTable, LguAccountsToolbar } from "../components";
import type { LguRoleFilter, LguStatusFilter } from "../types";
import { filterLguAccounts } from "../utils";

const EMPTY_ACCOUNTS: AccountSummary[] = [];
type PendingStatusChange = { account: AccountSummary; nextStatus: LguStatusFilter };

export function ITLguAccountsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<LguRoleFilter>("all");
  const [status, setStatus] = useState<LguStatusFilter>("active");
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingStatusChange | null>(null);
  const [pendingActivationResend, setPendingActivationResend] = useState<AccountSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const accountsQuery = useQuery({ queryKey: ["lgu-accounts"], queryFn: listLguAccounts });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const filteredAccounts = useMemo(() => filterLguAccounts(accounts, query, role, status), [accounts, query, role, status]);

  const activationMutation = useMutation({
    mutationFn: (accountId: string) => resendAccountActivation(accountId),
    onSuccess: async (updatedAccount) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }), queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })]);
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
        queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }),
        ...(activationEmailQueued ? [queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })] : []),
      ]);
      toast.success(activationEmailQueued ? "Account reactivated; activation email queued" : "Account status updated");
      setSelectedAccount((current) => (current?.id === updatedAccount.id ? updatedAccount : current));
      setPendingStatusChange(null);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update account status")),
  });

  return (
    <PageMotion>
      <PageHeader title="LGU Accounts" description="Create personnel accounts, send secure activation links, and manage access status." />

      <LguAccountsMetrics accounts={accounts} />

      <Panel className="mt-6 overflow-hidden">
        <LguAccountsToolbar query={query} role={role} status={status} onQueryChange={setQuery} onRoleChange={setRole} onStatusChange={setStatus} onCreate={() => setCreateOpen(true)} />
        <LguAccountsTable accounts={accounts} filteredAccounts={filteredAccounts} isLoading={accountsQuery.isLoading} onSelectAccount={setSelectedAccount} />
      </Panel>

      <AnimatePresence>
        {createOpen && <CreateLguAccountModal key="create-lgu-account" onClose={() => setCreateOpen(false)} />}
        {selectedAccount && (
          <LguAccountDetailsModal
            key={`lgu-account-details-${selectedAccount.id}`}
            account={selectedAccount}
            onClose={() => setSelectedAccount(null)}
            onAccountUpdated={setSelectedAccount}
            onResendActivation={setPendingActivationResend}
            onRequestStatusChange={(account, nextStatus) => setPendingStatusChange({ account, nextStatus })}
          />
        )}
        {pendingActivationResend && (
          <ConfirmActivationResendModal
            key={`lgu-activation-resend-${pendingActivationResend.id}`}
            account={pendingActivationResend}
            isPending={activationMutation.isPending}
            onClose={() => setPendingActivationResend(null)}
            onConfirm={() => activationMutation.mutate(pendingActivationResend.id)}
          />
        )}
        {pendingStatusChange && (
          <ConfirmAccountStatusModal
            key={`lgu-status-change-${pendingStatusChange.account.id}`}
            pendingStatusChange={pendingStatusChange}
            isPending={statusMutation.isPending}
            onClose={() => setPendingStatusChange(null)}
            onConfirm={() => statusMutation.mutate({ accountId: pendingStatusChange.account.id, nextStatus: pendingStatusChange.nextStatus })}
          />
        )}
      </AnimatePresence>
    </PageMotion>
  );
}

function ConfirmActivationResendModal({ account, isPending, onClose, onConfirm }: { account: AccountSummary; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame title="Resend Activation Email" onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <div className="flex gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <KeyRound size={20} />
          </span>
          <div>
            <p className="font-bold">This will issue a new activation link.</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
              Any previous activation link for {account.displayName} will stop working. TANAW will email a new single-use link so the user can create their password securely.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Account</p>
          <p className="mt-1 font-bold text-slate-900">{account.displayName}</p>
          <p className="text-sm text-slate-600">{account.email}</p>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:ring-4 focus:ring-slate-200 focus:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-900/15 transition hover:-translate-y-0.5 hover:bg-amber-700 focus:ring-4 focus:ring-amber-200 focus:outline-none disabled:translate-y-0 disabled:opacity-70"
          >
            {isPending ? "Sending..." : "Resend Activation Email"}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

function ConfirmAccountStatusModal({
  pendingStatusChange,
  isPending,
  onClose,
  onConfirm,
}: {
  pendingStatusChange: PendingStatusChange;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isDeactivating = pendingStatusChange.nextStatus === "inactive";
  const actionLabel = isDeactivating ? "Deactivate Account" : "Reactivate Account";

  return (
    <ModalFrame title={actionLabel} onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <div className="flex gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle size={20} />
          </span>
          <div>
            <p className="font-bold">{isDeactivating ? "This account will lose TANAW access." : "This account will regain TANAW access."}</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
              {isDeactivating
                ? `${pendingStatusChange.account.displayName} will not be able to sign in until the account is reactivated.`
                : pendingStatusChange.account.isActivated
                  ? `${pendingStatusChange.account.displayName} will regain access using their existing password.`
                  : `${pendingStatusChange.account.displayName} will be enabled again, and TANAW will send a new activation email to the registered address.`}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Account</p>
          <p className="mt-1 font-bold text-slate-900">{pendingStatusChange.account.displayName}</p>
          <p className="text-sm text-slate-600">{pendingStatusChange.account.email}</p>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:ring-4 focus:ring-slate-200 focus:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none disabled:translate-y-0 disabled:opacity-70 ${
              isDeactivating ? "bg-red-600 shadow-red-900/15 hover:bg-red-700 focus:ring-red-200" : "bg-tanaw-green focus:ring-tanaw-green/20 shadow-emerald-900/15 hover:bg-[#044a1e]"
            }`}
          >
            {isPending ? "Updating..." : actionLabel}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
