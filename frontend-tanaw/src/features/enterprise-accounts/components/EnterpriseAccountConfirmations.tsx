import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { ModalFrame } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/services/accountManagement";

type ConfirmationProps = {
  enterprise: AccountSummary;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmEnterpriseActivationModal({ enterprise, isPending, onClose, onConfirm }: ConfirmationProps) {
  const enterpriseName = enterprise.enterpriseName ?? enterprise.displayName;
  return (
    <ModalFrame title="Resend Activation Email" onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <WarningPanel icon={<KeyRound size={20} />} title="This will issue a new activation link.">
          Any previous activation link for {enterpriseName} will stop working. TANAW will email a new single-use link so the enterprise user can create their password securely.
        </WarningPanel>
        <EnterpriseActionAccountSummary enterprise={enterprise} />
        <ConfirmationActions cancelLabel="Cancel" confirmLabel="Resend Activation Email" pendingLabel="Sending..." isPending={isPending} onClose={onClose} onConfirm={onConfirm} tone="warning" />
      </div>
    </ModalFrame>
  );
}

export function ConfirmEnterpriseStatusModal({ enterprise, nextStatus, isPending, onClose, onConfirm }: ConfirmationProps & { nextStatus: AccountSummary["status"] }) {
  const enterpriseName = enterprise.enterpriseName ?? enterprise.displayName;
  const isDeactivating = nextStatus === "inactive";
  const actionLabel = isDeactivating ? "Deactivate Enterprise" : "Reactivate Enterprise";
  const description = isDeactivating
    ? `${enterpriseName} will not be able to sign in until the account is reactivated.`
    : enterprise.isActivated
      ? `${enterpriseName} will regain access using the existing account password.`
      : `${enterpriseName} will be enabled again, and TANAW will send a new activation email to the registered address.`;

  return (
    <ModalFrame title={actionLabel} onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="space-y-5">
        <WarningPanel icon={<AlertTriangle size={20} />} title={isDeactivating ? "This enterprise account will lose TANAW access." : "This enterprise account will regain TANAW access."}>
          {description}
        </WarningPanel>
        <EnterpriseActionAccountSummary enterprise={enterprise} />
        <ConfirmationActions
          cancelLabel="Cancel"
          confirmLabel={actionLabel}
          pendingLabel="Updating..."
          isPending={isPending}
          onClose={onClose}
          onConfirm={onConfirm}
          tone={isDeactivating ? "danger" : "success"}
        />
      </div>
    </ModalFrame>
  );
}

export function EnterpriseChangesConfirmation({
  changes,
  confirmLabel,
  isPending,
  onCancel,
  onConfirm,
  title,
}: {
  changes: string[];
  confirmLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="font-black text-amber-950">{title}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {changes.map((change) => (
              <li key={change} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onCancel} className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100">
              Cancel
            </button>
            <button type="button" disabled={isPending} onClick={onConfirm} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-70">
              {isPending ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WarningPanel({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <div className="tanaw-warning-panel flex gap-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950 dark:border-amber-300/30 dark:bg-[#261f16] dark:text-amber-100">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-1 dark:ring-amber-300/20">
        {icon}
      </span>
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-50/85">{children}</p>
      </div>
    </div>
  );
}

function EnterpriseActionAccountSummary({ enterprise }: { enterprise: AccountSummary }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-[#0c1728]">
      <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Enterprise</p>
      <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{enterprise.enterpriseName ?? enterprise.displayName}</p>
      <p className="text-sm text-slate-600 dark:text-slate-300">{enterprise.email}</p>
    </div>
  );
}

function ConfirmationActions({
  cancelLabel,
  confirmLabel,
  isPending,
  onClose,
  onConfirm,
  pendingLabel,
  tone,
}: {
  cancelLabel: string;
  confirmLabel: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pendingLabel: string;
  tone: "danger" | "success" | "warning";
}) {
  const confirmClass = {
    danger: "bg-red-600 shadow-red-900/15 hover:bg-red-700 focus:ring-red-200",
    success: "bg-tanaw-green focus:ring-tanaw-green/20 shadow-emerald-900/15 hover:bg-[#044a1e]",
    warning: "bg-amber-600 shadow-amber-900/15 hover:bg-amber-700 focus:ring-amber-200",
  }[tone];
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:ring-4 focus:ring-slate-200 focus:outline-none"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={onConfirm}
        className={`rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none disabled:translate-y-0 disabled:opacity-70 ${confirmClass}`}
      >
        {isPending ? pendingLabel : confirmLabel}
      </button>
    </div>
  );
}
