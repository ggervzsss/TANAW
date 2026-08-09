import { Building2, KeyRound, Pencil, UserCheck, XCircle } from "lucide-react";
import type { AccountSummary } from "@/shared/types";

type Props = {
  canChangeStatus: boolean;
  details: string[][];
  enterprise: AccountSummary;
  onEdit: () => void;
  onResendActivation: () => void;
  onStatusChange: () => void;
};

export function EnterpriseDetailsOverview({ canChangeStatus, details, enterprise, onEdit, onResendActivation, onStatusChange }: Props) {
  return (
    <>
      <section className="rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
              <Building2 size={24} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{enterprise.category ?? "Enterprise Account"}</p>
              <h3 className="mt-1 truncate text-2xl font-black text-slate-950">{enterprise.enterpriseName ?? enterprise.displayName}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{enterprise.email}</p>
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-black uppercase ${enterprise.status === "inactive" ? "bg-slate-100 text-slate-600" : enterprise.isActivated ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
          >
            {enterprise.status === "inactive" ? "inactive" : enterprise.isActivated ? "active" : "pending activation"}
          </span>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {details.map(([label, value]) => (
          <DetailCard key={label} label={label} value={value} />
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-xs font-black tracking-wide text-slate-500 uppercase">Enterprise Actions</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="bg-tanaw-green focus:ring-tanaw-green/15 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none"
          >
            <Pencil size={16} />
            Edit account information
          </button>
          {!enterprise.isActivated && enterprise.status === "active" && (
            <button
              type="button"
              onClick={onResendActivation}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-amber-100 focus:outline-none"
            >
              <KeyRound size={16} />
              Resend activation email
            </button>
          )}
          {canChangeStatus && (
            <button
              type="button"
              onClick={onStatusChange}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-slate-100 focus:outline-none"
            >
              {enterprise.status === "active" ? <XCircle size={16} /> : <UserCheck size={16} />}
              {enterprise.status === "active" ? "Deactivate enterprise" : "Reactivate enterprise"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-sm font-bold wrap-break-word text-slate-900">{value}</p>
    </div>
  );
}
