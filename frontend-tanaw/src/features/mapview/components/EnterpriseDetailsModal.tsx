import { Activity, BarChart3, Building2, Clock, MapPin, Phone, Radio, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ModalFrame } from "@/shared/components/ui";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { EnterpriseStatus, GatewayStatus } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type EnterpriseDetailsModalProps = {
  enterprise: MapEnterprise;
  onClose: () => void;
  onOpenInsights: () => void;
};

export function EnterpriseDetailsModal({ enterprise, onClose, onOpenInsights }: EnterpriseDetailsModalProps) {
  const { timeFormat } = useSystemDisplayPreferences();

  return (
    <ModalFrame title={enterprise.name} eyebrow="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-3xl border border-emerald-100 bg-emerald-50/60 p-5 shadow-sm dark:border-emerald-300/20 dark:bg-emerald-500/10">
          <div className="flex items-start gap-3">
            <span className="text-tanaw-green flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-emerald-100 dark:bg-[#172033] dark:text-emerald-200 dark:ring-emerald-300/20">
              <Building2 size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">Enterprise Overview</p>
              </div>
              <p className="mt-1 text-sm leading-relaxed font-semibold text-slate-700">
                {enterprise.category} - Barangay {enterprise.barangay}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <EnterpriseMetricCard icon={<Activity size={16} />} label="Total Live Occupancy" value={enterprise.totalLiveOccupancy.toLocaleString()} />
            <EnterpriseMetricCard icon={<Users size={16} />} label="Estimated Unique Visitors" value={enterprise.estimatedUniqueCount.toLocaleString()} />
            <EnterpriseMetricCard icon={<Radio size={16} />} label="Status" value={<StatusBadge status={enterprise.status} />} />
            <EnterpriseMetricCard icon={<TrendingUp size={16} />} label="Trend" value={enterprise.trend ?? "Stable"} />
          </div>
          <button
            type="button"
            onClick={onOpenInsights}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black tracking-wide text-white uppercase shadow-sm transition hover:bg-emerald-800"
          >
            <BarChart3 size={15} />
            View Visitor Insights
          </button>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <EnterpriseDetailRow icon={<Building2 size={15} />} label="Category" value={enterprise.category} />
          <EnterpriseDetailRow icon={<Radio size={15} />} label="Desktop App Status" value={<DesktopAppStatusBadge status={enterprise.gatewayStatus ?? "Not Linked"} />} />
          <EnterpriseDetailRow icon={<Clock size={15} />} label="Last update" value={enterprise.lastSync ? formatPhilippineDateTime(enterprise.lastSync, timeFormat) : "No update recorded"} />
          <EnterpriseDetailRow icon={<Phone size={15} />} label="Contact" value={enterprise.contact ?? "No contact listed"} />
          <EnterpriseDetailRow className="sm:col-span-2" icon={<MapPin size={15} />} label="Full Address" value={enterprise.fullAddress} />
          <EnterpriseDetailRow className="sm:col-span-2" icon={<Clock size={15} />} label="Operating Hours" value={enterprise.operatingHours ?? "Not specified"} />
        </section>
      </div>
    </ModalFrame>
  );
}

function EnterpriseMetricCard({ icon, label, value, className = "" }: { icon: ReactNode; label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white bg-white p-4 shadow-sm ring-1 ring-emerald-100/70 dark:border-slate-700 dark:bg-[#121c31] dark:ring-emerald-300/20 ${className}`}>
      <div className="text-tanaw-green flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-black tracking-[0.16em] text-slate-500 uppercase">{label}</p>
      </div>
      <div className="mt-2 text-lg leading-tight font-black text-slate-950 max-sm:text-base">{value}</div>
    </div>
  );
}

function EnterpriseDetailRow({ icon, label, value, className = "" }: { icon: ReactNode; label: string; value: ReactNode; className?: string }) {
  return (
    <div
      className={`flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm ring-1 ring-white dark:border-slate-700 dark:bg-[#0f172a] dark:ring-white/8 ${className}`}
    >
      <span className="text-tanaw-green mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-black tracking-[0.16em] text-slate-500 uppercase">{label}</p>
        <p className="mt-1 text-sm leading-relaxed font-bold wrap-break-word text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: EnterpriseStatus }) {
  const classes: Record<EnterpriseStatus, string> = {
    Normal: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-500/15 dark:text-emerald-200",
    Warning: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-300/30 dark:bg-yellow-400/15 dark:text-yellow-200",
    "High Occupancy": "border-red-200 bg-red-50 text-red-700 dark:border-red-300/30 dark:bg-red-500/15 dark:text-red-200",
    Issue: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-300/30 dark:bg-orange-500/15 dark:text-orange-200",
    Offline: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
    Inactive: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
  };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.16em] uppercase ${classes[status]}`}>{status}</span>;
}

function DesktopAppStatusBadge({ status }: { status: GatewayStatus }) {
  const classes: Record<GatewayStatus, string> = {
    Connected: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-500/15 dark:text-emerald-200",
    "Sync Delayed": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/15 dark:text-amber-200",
    Offline: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
    "Not Linked": "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
    Closed: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
  };
  const label: Record<GatewayStatus, string> = {
    Connected: "Online",
    "Sync Delayed": "Updates Delayed",
    Offline: "Offline",
    "Not Linked": "No Desktop App Linked",
    Closed: "Closed",
  };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.16em] uppercase ${classes[status]}`}>{label[status]}</span>;
}
