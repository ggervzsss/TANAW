import { Activity, Building2, Clock, MapPin, Phone, Radio, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ModalFrame } from "@/shared/components/ui";
import type { EnterpriseStatus, GatewayStatus } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";

type EnterpriseDetailsModalProps = {
  enterprise: MapEnterprise;
  onClose: () => void;
};

export function EnterpriseDetailsModal({ enterprise, onClose }: EnterpriseDetailsModalProps) {
  return (
    <ModalFrame title={enterprise.name} eyebrow="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-3xl border border-emerald-100 bg-emerald-50/60 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-tanaw-green flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-emerald-100">
              <Building2 size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-700 uppercase">Map Registry</p>
                {enterprise.sourceKind && enterprise.sourceKind !== "real" && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black tracking-[0.14em] text-amber-800 uppercase">Simulated Telemetry</span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed font-semibold text-slate-700">
                {enterprise.category} - Barangay {enterprise.barangay}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <EnterpriseMetricCard icon={<Activity size={16} />} label="Total Live Occupancy" value={enterprise.totalLiveOccupancy.toLocaleString()} />
            <EnterpriseMetricCard icon={<Users size={16} />} label="Est. Unique Count" value={enterprise.estimatedUniqueCount.toLocaleString()} />
            <EnterpriseMetricCard icon={<Radio size={16} />} label="Status" value={<StatusBadge status={enterprise.status} />} />
            <EnterpriseMetricCard icon={<TrendingUp size={16} />} label="Trend" value={enterprise.trend ?? "Stable"} />
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <EnterpriseDetailRow icon={<Building2 size={15} />} label="Category" value={enterprise.category} />
          <EnterpriseDetailRow icon={<Radio size={15} />} label="Gateway" value={<GatewayBadge status={enterprise.gatewayStatus ?? "Not Linked"} />} />
          <EnterpriseDetailRow icon={<Clock size={15} />} label="Last sync" value={enterprise.lastSync ?? "No sync recorded"} />
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
    <div className={`rounded-2xl border border-white bg-white p-4 shadow-sm ring-1 ring-emerald-100/70 ${className}`}>
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
    <div className={`flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm ring-1 ring-white ${className}`}>
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
    Normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Warning: "border-amber-200 bg-amber-50 text-amber-700",
    Critical: "border-red-200 bg-red-50 text-red-700",
  };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.16em] uppercase ${classes[status]}`}>{status}</span>;
}

function GatewayBadge({ status }: { status: GatewayStatus }) {
  const classes: Record<GatewayStatus, string> = {
    Connected: "border-emerald-200 bg-emerald-50 text-emerald-700",
    "Sync Delayed": "border-amber-200 bg-amber-50 text-amber-700",
    Offline: "border-red-200 bg-red-50 text-red-700",
    "Not Linked": "border-slate-200 bg-slate-100 text-slate-600",
    Closed: "border-slate-200 bg-slate-100 text-slate-600",
  };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.16em] uppercase ${classes[status]}`}>{status}</span>;
}
