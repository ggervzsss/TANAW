import { Activity, Building2, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { getDarkMonitoringBadgeClass, getOccupancyBadgeClass } from "../utils";

export function EnterpriseList({ children, count, title }: { children: ReactNode; count: ReactNode; title: string }) {
  return (
    <div className="tanaw-map-directory__card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-400/25 bg-[#111e32]/88 p-3 shadow-sm shadow-black/20">
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[9px] font-black tracking-widest text-white/80 uppercase">
          <Building2 size={13} className="text-tanaw-sky" /> {title}
        </h3>
        <span className="shrink-0 text-right text-[9px] leading-tight font-bold tracking-widest text-white/65 uppercase">{count}</span>
      </div>
      <div className="tanaw-map-directory__list min-h-0 flex-1 space-y-2 overflow-y-auto pr-1.5">{children}</div>
    </div>
  );
}

export function DirectoryEmptyMessage({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-white/15 bg-black/20 p-4 text-center text-[10px] leading-relaxed font-bold tracking-widest text-white/65 uppercase">{children}</div>;
}

export function EnterpriseMapCard({ enterprise, selected, onClick }: { enterprise: MapEnterprise; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus:ring-tanaw-sky w-full rounded-lg border p-2.5 text-left shadow-sm shadow-black/15 transition hover:-translate-y-0.5 hover:bg-white/10 focus:ring-2 focus:outline-none ${selected ? "border-tanaw-sky/60 bg-tanaw-sky/15" : "border-white/15 bg-slate-950/35"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.name}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} />
            <span className="truncate">{enterprise.fullAddress}</span>
          </div>
        </div>
        <span
          className={`flex max-w-[46%] shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-center text-[9px] leading-tight font-black tracking-widest uppercase ${getDarkMonitoringBadgeClass(enterprise.monitoringStatus)}`}
        >
          {enterprise.monitoringStatus}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">
          {enterprise.cameraMonitoring ? `${enterprise.cameraMonitoring.healthyCameraCount}/${enterprise.cameraMonitoring.configuredCameraCount} cameras` : "No camera telemetry"}
        </span>
        <span className={`justify-self-end rounded border px-1.5 py-0.5 font-sans text-[8px] font-black tracking-wider uppercase ${getOccupancyBadgeClass(enterprise.occupancyStatus)}`}>
          {enterprise.occupancyStatus}
        </span>
        <span className="text-white/70">Live Occupancy</span>
        <span className="flex items-center justify-end gap-1 font-bold text-white">
          <Activity size={12} className="text-tanaw-sky" />
          {enterprise.totalLiveOccupancy.toLocaleString()}
        </span>
        <span className="text-white/70">Est. Unique</span>
        <span className="text-right font-bold text-white">{enterprise.estimatedUniqueCount.toLocaleString()}</span>
      </div>
    </button>
  );
}

export function MonitoringLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[8px] font-bold tracking-wider text-white/70 uppercase">
      {[
        ["#16a34a", "All Running"],
        ["#ea580c", "Partial"],
        ["#64748b", "Stopped"],
        ["#dc2626", "Fault"],
      ].map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full ring-1 ring-white/40" style={{ backgroundColor: color }} />
          {label}
        </span>
      ))}
      <span className="text-white/50">Outer ring: occupancy alert</span>
    </div>
  );
}

export function UnpinnedEnterpriseCard({ enterprise }: { enterprise: AccountSummary }) {
  const status = enterprise.latitude === null || enterprise.longitude === null ? "Not Pinned" : "Needs Correction";
  return (
    <div className="w-full rounded-lg border border-dashed border-white/15 bg-slate-950/25 p-2.5 text-left shadow-sm shadow-black/15">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.enterpriseName ?? enterprise.displayName}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} />
            <span className="truncate">{enterprise.address ?? "Address not provided"}</span>
          </div>
        </div>
        <span className="flex max-w-[46%] shrink-0 items-center justify-center rounded border border-amber-400/30 bg-amber-900/35 px-1.5 py-0.5 text-center text-[9px] leading-tight font-black tracking-widest text-amber-100 uppercase">
          {status}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">{enterprise.category ?? "Uncategorized"}</span>
        <span className="truncate text-right font-bold text-white">{enterprise.barangay ?? "Unassigned"}</span>
      </div>
    </div>
  );
}
