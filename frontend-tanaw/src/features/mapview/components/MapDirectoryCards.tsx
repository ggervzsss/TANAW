import { ArrowLeft, Building2, ChevronRight, CircleAlert, CircleCheck, CircleDotDashed, CircleGauge, CirclePause, MapPinOff } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise, MonitoringStatus } from "@/shared/types";
import { getMonitoringStatusPresentation, getMonitoringStatusLabel, getOccupancyBadgeClass, monitoringStatusLegend, type MonitoringStatusTone } from "../utils";

const statusIcons: Record<MonitoringStatusTone, typeof CircleCheck> = {
  running: CircleCheck,
  partial: CircleGauge,
  inactive: CirclePause,
  fault: CircleAlert,
  unconfigured: CircleDotDashed,
};

export function MonitoringStatusBadge({ status }: { status: MonitoringStatus }) {
  const { badgeClass, tone } = getMonitoringStatusPresentation(status);
  const Icon = statusIcons[tone];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-left text-[11px] leading-tight font-semibold ${badgeClass}`}>
      <Icon size={13} className="shrink-0" aria-hidden="true" />
      {getMonitoringStatusLabel(status)}
    </span>
  );
}

export function EnterpriseList({ children, count, title, onBack }: { children: ReactNode; count: number; title: string; onBack?: () => void }) {
  return (
    <section className="tanaw-map-directory__results flex min-h-0 flex-1 flex-col" aria-labelledby="spatial-enterprise-title">
      <div className="tanaw-map-directory__results-header">
        <div className="min-w-0">
          {onBack && <p className="tanaw-map-directory__result-caption">Enterprises in this barangay</p>}
          <h3 id="spatial-enterprise-title" className="tanaw-map-directory__section-title font-display font-bold">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="tanaw-map-directory__count" aria-live="polite">
            {count} {count === 1 ? "enterprise" : "enterprises"}
          </span>
          {onBack && (
            <button type="button" onClick={onBack} className="tanaw-map-directory__back" title="Back to Barangay Directory">
              <ArrowLeft size={13} aria-hidden="true" /> All Barangays
            </button>
          )}
        </div>
      </div>
      <div tabIndex={0} role="region" aria-label="Enterprise results" className="tanaw-map-directory__list min-h-0 flex-1 overflow-y-auto">
        <ul className="tanaw-map-directory__records">{children}</ul>
      </div>
    </section>
  );
}

export function DirectoryEmptyMessage({ children }: { children: ReactNode }) {
  return <li className="tanaw-map-directory__empty p-5 text-center text-sm leading-relaxed font-medium">{children}</li>;
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
  const addressId = useId();
  const detailsId = useId();
  const { cameraMonitoring, occupancyStatus, totalLiveOccupancy } = enterprise;
  return (
    <div
      onPointerEnter={() => onHoverChange(enterprise.id)}
      onPointerLeave={() => onHoverChange(null)}
      data-selected={selected}
      className="tanaw-map-enterprise-card"
    >
      <span className="tanaw-map-enterprise-card__identity">
        <button
          type="button"
          className="tanaw-map-enterprise-card__title tanaw-map-enterprise-card__select"
          aria-pressed={selected}
          aria-describedby={`${addressId} ${detailsId}`}
          onClick={onClick}
          onFocus={() => onHoverChange(enterprise.id)}
          onBlur={() => onHoverChange(null)}
        >
          {enterprise.name}
        </button>
        <span id={addressId} className="tanaw-map-enterprise-card__address" title={enterprise.fullAddress}>
          {enterprise.fullAddress}
        </span>
      </span>
      <span id={detailsId} className="tanaw-map-enterprise-card__details">
        <span className="tanaw-map-enterprise-card__status">
          <MonitoringStatusBadge status={enterprise.monitoringStatus} />
        </span>
        <span className="tanaw-map-enterprise-card__telemetry">
          <span>
            <span className="tanaw-map-enterprise-card__metric-label">Cameras</span>
            {cameraMonitoring ? (
              <span className="tanaw-map-enterprise-card__measure">
                <strong>
                  {cameraMonitoring.healthyCameraCount}/{cameraMonitoring.configuredCameraCount}
                </strong>{" "}
                <span>cameras reporting</span>
              </span>
            ) : (
              <span className="tanaw-map-enterprise-card__missing">No camera telemetry</span>
            )}
          </span>
          <span>
            <span className="tanaw-map-enterprise-card__metric-label">Live Occupancy</span>
            <span className="tanaw-map-enterprise-card__measure">
              {totalLiveOccupancy === null ? "No live data" : <strong>{totalLiveOccupancy.toLocaleString()}</strong>}
              {(totalLiveOccupancy !== null || occupancyStatus !== "No Data") && (
                <span className={`rounded-full border px-1.5 text-[10px] font-semibold ${getOccupancyBadgeClass(occupancyStatus)}`}>{occupancyStatus}</span>
              )}
            </span>
          </span>
        </span>
      </span>
      <ChevronRight className="tanaw-map-enterprise-card__arrow" size={17} aria-hidden="true" />
    </div>
  );
}

export function MonitoringLegend() {
  return (
    <div className="tanaw-map-directory__legend" role="group" aria-label="Camera monitoring status legend">
      <div className="tanaw-map-directory__legend-heading">
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={14} aria-hidden="true" /> Map markers
        </span>
        <span className="tanaw-map-directory__legend-note">
          <span className="tanaw-map-directory__legend-ring" aria-hidden="true" />
          Ring indicates an occupancy alert
        </span>
      </div>
      <ul className="tanaw-map-directory__legend-list">
        {monitoringStatusLegend.map(({ tone, label, color }) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <span className="tanaw-map-directory__legend-dot" style={{ backgroundColor: color }} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UnpinnedEnterpriseCard({ enterprise }: { enterprise: AccountSummary }) {
  const status = enterprise.latitude === null || enterprise.longitude === null ? "Not Pinned" : "Needs Correction";
  return (
    <article className="tanaw-map-enterprise-card tanaw-map-enterprise-card--unpinned">
      <div className="tanaw-map-enterprise-card__identity">
        <h4 className="tanaw-map-enterprise-card__title">{enterprise.enterpriseName ?? enterprise.displayName}</h4>
        <p className="tanaw-map-enterprise-card__address">{enterprise.address ?? "Address not provided"}</p>
      </div>
      <div className="tanaw-map-enterprise-card__details">
        <span className="tanaw-map-enterprise-card__unpinned-status">
          <MapPinOff size={13} aria-hidden="true" /> {status}
        </span>
        <p className="tanaw-map-enterprise-card__missing">{[enterprise.category ?? "Uncategorized", enterprise.barangay ?? "Unassigned"].join(" · ")}</p>
      </div>
    </article>
  );
}
