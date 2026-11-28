import { LogIn, LogOut, Users, type LucideIcon } from "lucide-react";
import { Skeleton, SkeletonLine } from "../../../ui-kit/components/Spinner";

/**
 * Camera Setup in outline while its code loads: the page heading, the My Cameras rail and the
 * selected camera, built from the page's own classes so each part keeps its size and place.
 */
export function CameraSetupSkeleton({ label = "Loading camera setup" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="camera-management tanaw-skeleton-screen flex h-full min-h-0 flex-col overflow-hidden font-sans">
      <div className="camera-page-heading" aria-hidden="true">
        <div className="min-w-0">
          <h2>
            <SkeletonLine width="16rem" />
          </h2>
          <p>
            <SkeletonLine width="20rem" />
          </p>
        </div>
      </div>
      <div data-camera-view="monitoring" className="camera-workspace" aria-hidden="true">
        <div className="camera-list">
          <div className="camera-list-heading">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="camera-list-items">
            <CameraListPlaceholders />
          </div>
          <div className="camera-list-footer">
            <Skeleton className="h-10.5 w-full" />
          </div>
        </div>
        <div className="camera-workspace-main">
          <CameraMonitorSkeleton />
        </div>
      </div>
    </div>
  );
}

/** Rows in the shape of My Cameras entries: the glyph, then the name, the zone and the status line. */
export function CameraListPlaceholders() {
  return (
    <span className="camera-list-placeholders" role="status" aria-label="Loading cameras">
      {[0, 1, 2].map((row) => (
        <span key={row} className="camera-list-placeholder" aria-hidden="true">
          <Skeleton className="camera-list-placeholder-glyph" />
          <span className="camera-list-placeholder-copy">
            <Skeleton className="my-0.5 h-3.5 w-4/5" />
            <Skeleton className="my-0.5 h-3 w-1/2" />
            <Skeleton className="mt-0.5 h-5 w-24" shape="pill" />
          </span>
        </span>
      ))}
    </span>
  );
}

const METRIC_TILES: ReadonlyArray<{ tone: string; label: string; icon: LucideIcon; detail?: boolean }> = [
  { tone: "entry", label: "Entry", icon: LogIn },
  { tone: "exit", label: "Exit", icon: LogOut },
  { tone: "occupancy", label: "Live Occupancy", icon: Users, detail: true },
  { tone: "visitors", label: "Visitors", icon: Users },
];

/** The monitoring layout in outline while the saved cameras load. */
export function CameraMonitorSkeleton() {
  return (
    <div className="camera-preview-card camera-preview-card--loading" role="status" aria-label="Loading camera">
      <div className="camera-preview-heading" aria-hidden="true">
        <Skeleton className="camera-skeleton-icon" />
        <span className="camera-identity">
          <span className="camera-identity-title">
            <h3>
              <SkeletonLine width="12rem" />
            </h3>
          </span>
          <p>
            <SkeletonLine width="8rem" />
          </p>
        </span>
        <span className="camera-header-actions">
          <Skeleton className="h-10.5 w-28" />
        </span>
      </div>
      <div className="camera-preview-layout" aria-hidden="true">
        <div className="camera-preview-surface">
          <div className="camera-preview-toolbar">
            <Skeleton className="h-4 w-32" />
            <span className="camera-preview-actions">
              <Skeleton className="h-8.5 w-32" />
              <Skeleton className="h-8.5 w-8.5" />
            </span>
          </div>
          <div className="camera-preview-frame">
            <Skeleton className="camera-skeleton-stage" />
          </div>
        </div>
        <div className="camera-live-metrics">
          <div className="camera-metrics-heading">
            <Skeleton className="h-4 w-28" />
          </div>
          {/* Tile titles are fixed, so they show as they will; only the counts wait. */}
          <div className="camera-metrics-grid" data-mode="entrance-exit">
            {METRIC_TILES.map(({ tone, label, icon: Icon, detail }) => (
              <div key={tone} className="camera-metric camera-metric--placeholder" data-tone={tone}>
                <div className="camera-metric-label">
                  <h5>{label}</h5>
                  <span className="camera-metric-label-icon">
                    <Icon size={16} />
                  </span>
                </div>
                {detail && <Skeleton className="camera-metric-skeleton-detail" />}
                <Skeleton className="camera-metric-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
