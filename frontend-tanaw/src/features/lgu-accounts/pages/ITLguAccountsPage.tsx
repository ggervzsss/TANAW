import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { AlertTriangle, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { ModalFrame, PageMotion } from "@/shared/components/ui";
import { type AccountSummary, listLguAccounts, resetAccountPassword, updateAccountStatus } from "@/shared/services/accountManagement";
import { CreateLguAccountModal, LguAccountDetailsModal, LguAccountsMetrics, LguAccountsTable, LguAccountsToolbar } from "../components";
import type { LguRoleFilter, LguStatusFilter } from "../types";
import { filterLguAccounts } from "../utils";

const EMPTY_ACCOUNTS: AccountSummary[] = [];
type PendingStatusChange = { account: AccountSummary; nextStatus: LguStatusFilter };
type ApiErrorPayload = { detail?: string };

export function ITLguAccountsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<LguRoleFilter>("all");
  const [status, setStatus] = useState<LguStatusFilter>("active");
  const [selectedAccount, setSelectedAccount] = useState<AccountSummary | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingStatusChange | null>(null);
  const [pendingPasswordReset, setPendingPasswordReset] = useState<AccountSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const accountsQuery = useQuery({ queryKey: ["lgu-accounts"], queryFn: listLguAccounts });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const filteredAccounts = useMemo(() => filterLguAccounts(accounts, query, role, status), [accounts, query, role, status]);

  const resetMutation = useMutation({
    mutationFn: (accountId: string) => resetAccountPassword(accountId),
    onSuccess: async (updatedAccount) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }), queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] })]);
      toast.success("Temporary credentials sent by email");
      setSelectedAccount((current) => (current?.id === updatedAccount.id ? updatedAccount : current));
      setPendingPasswordReset(null);
    },
    onError: (error) => toast.error(getStatusErrorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ accountId, nextStatus }: { accountId: string; nextStatus: LguStatusFilter }) => updateAccountStatus(accountId, nextStatus),
    onSuccess: async (updatedAccount) => {
      await queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] });
      toast.success("Account status updated");
      setSelectedAccount((current) => (current?.id === updatedAccount.id ? updatedAccount : current));
      setPendingStatusChange(null);
    },
    onError: (error) => toast.error(getStatusErrorMessage(error)),
  });

  return (
    <PageMotion>
      <PageHeader title="LGU Accounts" description="Create personnel accounts, issue temporary credentials, and manage access status." />

      <LguAccountsMetrics accounts={accounts} />

      <Panel className="mt-6 overflow-hidden">
        <LguAccountsToolbar query={query} role={role} status={status} onQueryChange={setQuery} onRoleChange={setRole} onStatusChange={setStatus} onCreate={() => setCreateOpen(true)} />
        <LguAccountsTable accounts={accounts} filteredAccounts={filteredAccounts} isLoading={accountsQuery.isLoading} onSelectAccount={setSelectedAccount} />
      </Panel>

      <AnimatePresence>
        {createOpen && <CreateLguAccountModal onClose={() => setCreateOpen(false)} />}
        {selectedAccount && (
          <LguAccountDetailsModal
            account={selectedAccount}
            onClose={() => setSelectedAccount(null)}
            onAccountUpdated={setSelectedAccount}
            onResetCredentials={setPendingPasswordReset}
            onRequestStatusChange={(account, nextStatus) => setPendingStatusChange({ account, nextStatus })}
          />
        )}
        {pendingPasswordReset && (
          <ConfirmPasswordResetModal
            account={pendingPasswordReset}
            isPending={resetMutation.isPending}
            onClose={() => setPendingPasswordReset(null)}
            onConfirm={() => resetMutation.mutate(pendingPasswordReset.id)}
          />
        )}
        {pendingStatusChange && (
          <ConfirmAccountStatusModal
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

function ConfirmPasswordResetModal({ account, isPending, onClose, onConfirm }: { account: AccountSummary; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame title="Reset Credentials" onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <div className="flex gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <KeyRound size={20} />
          </span>
          <div>
            <p className="font-bold">This will generate new temporary credentials.</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
              The current password for {account.displayName} will stop working. New temporary credentials will be sent to the registered email, and the user will need to change the password after signing in.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Account</p>
          <p className="mt-1 font-bold text-slate-900">{account.displayName}</p>
          <p className="text-sm text-slate-600">{account.email}</p>
        </div>
        {account.role === "it" && (
          <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            TANAW blocks self-resets and last-active IT resets so this action cannot silently lock out the IT Personnel role.
          </p>
        )}
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
            {isPending ? "Resetting..." : "Reset Credentials"}
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
                : `${pendingStatusChange.account.displayName} will be able to sign in again if their credentials are valid.`}
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

function getStatusErrorMessage(error: unknown) {
  if (isAxiosError<ApiErrorPayload>(error)) {
    return error.response?.data?.detail ?? "Unable to update account status";
  }
  return "Unable to update account status";
}
