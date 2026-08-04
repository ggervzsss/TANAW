import { AlertTriangle, KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { ModalFrame } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/types";
import type { PendingLguStatusChange } from "../hooks";

export function ConfirmLguActivationResend({ account, isPending, onClose, onConfirm }: { account: AccountSummary; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ConfirmationFrame
      title="Resend Activation Email"
      account={account}
      icon={<KeyRound size={20} />}
      message={`Any previous activation link for ${account.displayName} will stop working. TANAW will email a new single-use link so the user can create their password securely.`}
      heading="This will issue a new activation link."
      confirmLabel="Resend Activation Email"
      isPending={isPending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

export function ConfirmLguAccountStatus({
  pendingStatusChange,
  isPending,
  onClose,
  onConfirm,
}: {
  pendingStatusChange: PendingLguStatusChange;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { account, nextStatus } = pendingStatusChange;
  const isDeactivating = nextStatus === "inactive";
  const actionLabel = isDeactivating ? "Deactivate Account" : "Reactivate Account";
  const message = isDeactivating
    ? `${account.displayName} will not be able to sign in until the account is reactivated.`
    : account.isActivated
      ? `${account.displayName} will regain access using their existing password.`
      : `${account.displayName} will be enabled again, and TANAW will send a new activation email to the registered address.`;
  return (
    <ConfirmationFrame
      title={actionLabel}
      account={account}
      icon={<AlertTriangle size={20} />}
      heading={isDeactivating ? "This account will lose TANAW access." : "This account will regain TANAW access."}
      message={message}
      confirmLabel={actionLabel}
      danger={isDeactivating}
      isPending={isPending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function ConfirmationFrame({
  account,
  confirmLabel,
  danger = false,
  heading,
  icon,
  isPending,
  message,
  onClose,
  onConfirm,
  title,
}: {
  account: AccountSummary;
  confirmLabel: string;
  danger?: boolean;
  heading: string;
  icon: ReactNode;
  isPending: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <ModalFrame title={title} onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <div className="tanaw-warning-panel flex gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950 dark:border-amber-300/30 dark:bg-[#261f16] dark:text-amber-100">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-1 dark:ring-amber-300/20">
            {icon}
          </span>
          <div>
            <p className="font-bold">{heading}</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-50/85">{message}</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-[#0c1728]">
          <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Account</p>
          <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{account.displayName}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">{account.email}</p>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:ring-4 focus:ring-slate-200 focus:outline-none dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none disabled:translate-y-0 disabled:opacity-70 ${danger ? "bg-red-600 shadow-red-900/15 hover:bg-red-700 focus:ring-red-200" : "bg-amber-600 shadow-amber-900/15 hover:bg-amber-700 focus:ring-amber-200"}`}
          >
            {isPending ? "Updating..." : confirmLabel}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
