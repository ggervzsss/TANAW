import { CheckCircle2, KeyRound, Mail, Pencil, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import type { AccountSummary } from "@/shared/services/accountManagement";
import { canDeactivateAccount } from "@/shared/utils/accountState";
import type { LguStatusFilter } from "../types";
import { lguRoleLabel } from "../utils";

type Detail = readonly [string, string];
type EmailRequest = AccountSummary["profileChangeRequests"][number];

export function LguAccountSummary({ account, details }: { account: AccountSummary; details: ReadonlyArray<Detail> }) {
  const isProtected = account.isProtectedDefault;
  return (
    <>
      <section className="rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{lguRoleLabel[account.role] ?? account.role}</p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{account.displayName}</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">{account.email}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-black uppercase ${account.status === "inactive" ? "bg-slate-100 text-slate-600" : account.isActivated ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
          >
            {account.status === "inactive" ? "inactive" : account.isActivated ? "active" : "pending activation"}
          </span>
        </div>
        {isProtected && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-white/80 p-3 text-sm font-semibold text-emerald-900">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <span>Startup-seeded system account is protected.</span>
          </div>
        )}
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-black tracking-wide text-slate-500 uppercase">{label}</p>
            <p className="mt-1 text-sm font-bold wrap-break-word text-slate-900">{value}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export function LguEmailChangeRequest({
  account,
  request,
  isPending,
  onResolve,
}: {
  account: AccountSummary;
  request: EmailRequest;
  isPending: boolean;
  onResolve: (action: "approve" | "decline") => void;
}) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Mail size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-amber-950">Email change requested</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${request.canApprove ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {request.canApprove ? "Ownership verified" : "Awaiting verification"}
            </span>
          </div>
          <p className="mt-1 text-sm text-amber-900/80">
            Proposed address: <strong className="wrap-break-word">{request.requestedValue}</strong>
          </p>
          <p className="mt-1 text-xs text-amber-800">The registered address remains {account.email} until approval.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => onResolve("decline")}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-60"
            >
              <XCircle size={14} /> Decline
            </button>
            <button
              type="button"
              disabled={isPending || !request.canApprove}
              onClick={() => onResolve("approve")}
              title={!request.canApprove ? "The proposed owner must open the verification link first." : undefined}
              className="bg-tanaw-green inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={14} /> Approve verified email
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LguAccountActions({
  account,
  onEdit,
  onResendActivation,
  onRequestStatusChange,
}: {
  account: AccountSummary;
  onEdit: () => void;
  onResendActivation: () => void;
  onRequestStatusChange: (status: LguStatusFilter) => void;
}) {
  const nextStatus = account.status === "active" ? "inactive" : "active";
  const disabled = account.isProtectedDefault;
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-xs font-black tracking-wide text-slate-500 uppercase">Account Actions</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="focus:ring-tanaw-green/15 bg-tanaw-green inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:hover:translate-y-0"
        >
          <Pencil size={16} /> Edit account information
        </button>
        {!account.isActivated && account.status === "active" && (
          <button
            type="button"
            onClick={onResendActivation}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            <KeyRound size={16} /> Resend activation email
          </button>
        )}
        {(account.status === "inactive" || canDeactivateAccount(account)) && (
          <button
            type="button"
            onClick={() => onRequestStatusChange(nextStatus)}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {account.status === "active" ? <XCircle size={16} /> : <UserCheck size={16} />}
            {account.status === "active" ? "Deactivate account" : "Reactivate account"}
          </button>
        )}
      </div>
    </div>
  );
}
