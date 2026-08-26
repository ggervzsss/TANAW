import { Activity, Building2, Camera, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { getDarkMonitoringBadgeClass, getOccupancyBadgeClass, monitoringStatusLegend } from "../utils";

export function EnterpriseList({ children, count, title }: { children: ReactNode; count: ReactNode; title: string }) {
  return (
    <div className="tanaw-map-directory__results flex min-h-0 flex-1 flex-col rounded-2xl p-4">
      <div className="tanaw-map-directory__results-header mb-3 flex shrink-0 items-center justify-between gap-3 pb-3">
        <h3 className="tanaw-map-directory__section-title flex min-w-0 items-center gap-2 text-xs font-bold">
          <Building2 size={16} aria-hidden="true" /> {title}
        </h3>
        <span className="tanaw-map-directory__count shrink-0 rounded-full px-2.5 py-1 text-right font-mono text-[10px] leading-tight font-bold">{count}</span>
      </div>
      <div className="tanaw-map-directory__list min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-2">{children}</div>
    </div>
  );
}

export function DirectoryEmptyMessage({ children }: { children: ReactNode }) {
  return <div className="tanaw-map-directory__empty rounded-xl border p-5 text-center text-xs leading-relaxed font-medium">{children}</div>;
}

export function EnterpriseMapCard({
  enterprise,
  selected,
  onClick,
  onHoverChange,
}: {
  enterprise: MapEnterprise;
  selected: boolean;
  onClick: () => void;
  onHoverChange: (enterpriseId: string | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => onHoverChange(enterprise.id)}
      onPointerLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(enterprise.id)}
      onBlur={() => onHoverChange(null)}
      aria-pressed={selected}
      data-selected={selected}
      className="tanaw-map-enterprise-card relative w-full overflow-hidden rounded-2xl border p-3.5 text-left"
    >
      <span className="tanaw-map-enterprise-card__selection absolute inset-y-3 left-0 w-0.75 rounded-r-full" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="tanaw-map-enterprise-card__title text-[13px] leading-snug font-bold">{enterprise.name}</h4>
          <div className="tanaw-map-enterprise-card__address mt-1.5 flex items-center gap-1.5 text-[10px] leading-snug font-medium">
            <MapPin size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate" title={enterprise.fullAddress}>
              {enterprise.fullAddress}
            </span>
          </div>
        </div>
        <span
          className={`flex max-w-[46%] shrink-0 items-center justify-center rounded-full border px-2.5 py-1 text-center text-[9px] leading-tight font-bold ${getDarkMonitoringBadgeClass(enterprise.monitoringStatus)}`}
        >
          {enterprise.monitoringStatus}
        </span>
      </div>
      <div className="tanaw-map-enterprise-card__operations mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <span className="tanaw-map-enterprise-card__camera flex min-w-0 items-center gap-1.5 text-[10px] font-medium">
          <Camera size={13} className="shrink-0" aria-hidden="true" />
          <span className="truncate">
            {enterprise.cameraMonitoring ? `${enterprise.cameraMonitoring.healthyCameraCount}/${enterprise.cameraMonitoring.configuredCameraCount} cameras` : "No camera telemetry"}
          </span>
        </span>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold ${getOccupancyBadgeClass(enterprise.occupancyStatus)}`}>{enterprise.occupancyStatus}</span>
      </div>
      <dl className="tanaw-map-enterprise-card__metrics mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[11px]">
        <dt>Live Occupancy</dt>
        <dd className="flex items-center justify-end gap-1.5 font-mono font-bold tabular-nums">
          <Activity size={13} aria-hidden="true" />
          {enterprise.totalLiveOccupancy.toLocaleString()}
        </dd>
        <dt>Est. Unique</dt>
        <dd className="text-right font-mono font-bold tabular-nums">{enterprise.estimatedUniqueCount.toLocaleString()}</dd>
      </dl>
    </button>
  );
}

export function MonitoringLegend() {
  return (
    <div className="tanaw-map-directory__legend mt-4 border-t pt-3" aria-label="Camera monitoring status legend">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] font-semibold">
        {monitoringStatusLegend.map(({ tone, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="tanaw-map-directory__legend-dot h-2.5 w-2.5 rounded-full" data-tone={tone} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <p className="tanaw-map-directory__legend-note mt-2 text-[10px] font-medium">Outer ring: occupancy alert</p>
    </div>
  );
}

export function UnpinnedEnterpriseCard({ enterprise }: { enterprise: AccountSummary }) {
  const status = enterprise.latitude === null || enterprise.longitude === null ? "Not Pinned" : "Needs Correction";
  return (
    <div className="tanaw-map-enterprise-card tanaw-map-enterprise-card--unpinned w-full rounded-2xl border border-dashed p-3.5 text-left">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="tanaw-map-enterprise-card__title text-[13px] leading-snug font-bold">{enterprise.enterpriseName ?? enterprise.displayName}</h4>
          <div className="tanaw-map-enterprise-card__address mt-1.5 flex items-center gap-1.5 text-[10px] font-medium">
            <MapPin size={12} aria-hidden="true" />
            <span className="truncate" title={enterprise.address ?? "Address not provided"}>
              {enterprise.address ?? "Address not provided"}
            </span>
          </div>
        </div>
        <span className="flex max-w-[46%] shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-center text-[9px] leading-tight font-bold text-amber-800 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-200">
          {status}
        </span>
      </div>
      <div className="tanaw-map-enterprise-card__operations mt-3 grid grid-cols-2 gap-x-2 border-t pt-3 font-mono text-[10px]">
        <span className="truncate">{enterprise.category ?? "Uncategorized"}</span>
        <span className="tanaw-map-enterprise-card__title truncate text-right font-bold">{enterprise.barangay ?? "Unassigned"}</span>
      </div>
    </div>
  );
}
