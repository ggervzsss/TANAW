import { SkeletonLine } from "../../../ui-kit/components/Spinner";
import { cn } from "../../../ui-kit/lib/cn";

/**
 * The Dashboard in outline while its code loads. It is built from the Dashboard's own classes, so
 * the header, figures, Visitor Traffic, Monitored Locations and Recent Reports keep the size and
 * place they take once the page arrives, at every window size.
 */
export function DashboardSkeleton({ label = "Loading dashboard", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("overview-layout dash tanaw-skeleton-screen", className)}>
      <div className="overview-main dash-main" aria-hidden="true">
        <div className="dash-hero">
          <div className="dash-head">
            <div className="dash-head-title">
              <div className="dash-title">
                <SkeletonLine width="13rem" />
              </div>
              <div className="dash-subtitle">
                <SkeletonLine width="9rem" />
              </div>
            </div>
            <div className="dash-head-actions">
              <span className="dash-date-trigger">
                <SkeletonLine width="15rem" />
              </span>
            </div>
          </div>
          <div className="dash-figures">
            {[0, 1, 2, 3].map((figure) => (
              <div key={figure} className="dash-figure">
                <div className="dash-figure-label">
                  <span className="dash-figure-name">
                    <SkeletonLine width="8rem" />
                  </span>
                  <small>
                    <SkeletonLine width="9.5rem" />
                  </small>
                </div>
                <span className="design-skeleton dash-figure-skeleton" />
                <span className="design-skeleton dash-note-skeleton" />
              </div>
            ))}
          </div>
        </div>
        <div className="dash-split">
          <div className="dash-traffic">
            <div className="dash-traffic-head">
              <div className="dash-section-head">
                <div className="dash-section-title">
                  <SkeletonLine width="10rem" />
                </div>
                <span className="design-skeleton dash-line-skeleton" />
              </div>
              <span className="design-skeleton dash-readout-skeleton" />
            </div>
            <TrafficChartLoading />
          </div>
          <div className="dash-side">
            <div className="dash-locations">
              <div className="dash-section-title">
                <SkeletonLine width="13rem" />
              </div>
              <div className="dash-section-sub">
                <SkeletonLine width="11rem" />
              </div>
              <LocationListLoading />
            </div>
          </div>
        </div>
        <div className="dash-reports">
          <div className="dash-section-head dash-section-head-row">
            <div>
              <div className="dash-section-title">
                <SkeletonLine width="11rem" />
              </div>
              <div className="dash-section-sub">
                <SkeletonLine width="17rem" />
              </div>
            </div>
            <span className="dash-link">
              <SkeletonLine width="4.5rem" />
            </span>
          </div>
          <ReportListLoading />
        </div>
      </div>
    </div>
  );
}

/** Visitor Traffic while its counts load: bars on the plot, then the key row under it. */
export function TrafficChartLoading({ label }: { label?: string }) {
  return (
    <div className="dash-chart-loading" aria-busy={label ? true : undefined} aria-label={label}>
      <div className="dash-chart-skeleton">
        {[38, 52, 64, 72, 86, 100, 80].map((height, index) => (
          <span key={height} className="design-skeleton" style={{ height: `${height}%`, animationDelay: `0ms, ${index * 80}ms` }} />
        ))}
      </div>
      <div className="dash-chart-foot">
        <span className="dash-legend">
          <SkeletonLine width="22rem" />
        </span>
      </div>
    </div>
  );
}

/** Monitored Locations while the cameras' states load. */
export function LocationListLoading({ label }: { label?: string }) {
  return (
    <ul className="dash-location-list" aria-busy={label ? true : undefined} aria-label={label}>
      {[0, 1, 2].map((row) => (
        <li key={row} className="dash-location">
          <span className="design-skeleton dash-location-icon" />
          <div className="dash-location-body">
            <span className="design-skeleton dash-line-skeleton" style={{ width: "60%" }} />
            <span className="design-skeleton dash-line-skeleton dash-line-skeleton-sm" style={{ width: "80%" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Recent Reports while the saved reports load: the column names, then the one report row. */
export function ReportListLoading({ label }: { label?: string }) {
  return (
    <div className="dash-report-loading" aria-busy={label ? true : undefined} aria-label={label}>
      <div className="dash-report-columns" aria-hidden="true">
        <span>Report</span>
        <span>Sent to</span>
        <span>Date</span>
        <span>Status</span>
      </div>
      <div className="dash-report-row dash-report-row-skeleton">
        <span className="dash-report-name">
          <span className="design-skeleton dash-report-icon" />
          <span className="design-skeleton dash-line-skeleton" style={{ width: "70%" }} />
        </span>
        <span className="design-skeleton dash-line-skeleton dash-report-cell" />
        <span className="design-skeleton dash-line-skeleton dash-report-cell" />
        <span className="design-skeleton dash-line-skeleton" style={{ marginLeft: "auto", width: "60%" }} />
      </div>
    </div>
  );
}
