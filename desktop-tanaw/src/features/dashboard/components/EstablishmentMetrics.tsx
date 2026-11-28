import type { ReactNode } from "react";
import type { Camera } from "../../../types/enterprise";
import type { EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { DashboardRange } from "../types/dashboard";
import { isSingleDay, rangePhrase } from "../utils/dashboard-range";
import { isCameraCounting } from "../utils/establishment";
import { useSkeletonReveal } from "../../../ui-kit/lib/skeleton";

type MetricsProps = {
  cameras: Camera[];
  summary: EstablishmentSummary | null;
  live: EstablishmentLive | null;
  range: DashboardRange;
  today: string;
  loading: boolean;
};

const count = (value: number) => value.toLocaleString("en-US");

function Figure({ segment, name, qualifier, tone, children }: { segment: string; name: string; qualifier: string; tone?: "alert"; children: ReactNode }) {
  return (
    <article className={`dash-figure${tone ? ` dash-figure-${tone}` : ""}`} data-metric-segment={segment}>
      <h3 className="dash-figure-label">
        <span className="dash-figure-name">{name}</span> <small>{qualifier}</small>
      </h3>
      {children}
    </article>
  );
}

/**
 * The figure itself, with no caption under it. A dash says nothing on its own, so `missing` tells a
 * screen reader why the figure is not there.
 */
function Value({ loading, reveal, missing, children }: { loading: boolean; reveal?: string; missing?: string | null; children: ReactNode }) {
  if (loading) return <span className="design-skeleton dash-figure-skeleton" aria-hidden="true" />;
  return (
    <strong className={reveal ? `dash-figure-value ${reveal}` : "dash-figure-value"}>
      {children}
      {missing && <span className="sr-only">. {missing}</span>}
    </strong>
  );
}

export function EstablishmentMetrics({ cameras, summary, live, range, today, loading }: MetricsProps) {
  const counting = cameras.filter((camera) => isCameraCounting(camera.id, live));
  const stopped = live ? cameras.filter((camera) => !isCameraCounting(camera.id, live)) : [];
  const entriesUnavailable = summary?.movement_state === "unavailable";
  const single = isSingleDay(range);
  const peakValue = summary?.peak_occupancy ?? null;
  const occupancy = live?.occupancy ?? null;
  // The four figures arrive together, fading in where their placeholders stood.
  const reveal = useSkeletonReveal(loading);

  return (
    <section className="dash-figures" data-unified-metrics-header aria-label="Enterprise analytics summary" aria-busy={loading}>
      {/* Which camera is not counting reads in Monitored Locations; here the bars say how many. */}
      <Figure segment="cameras" name="Cameras" qualifier="counting right now" tone={stopped.length ? "alert" : undefined}>
        <Value loading={loading} reveal={reveal}>
          {counting.length}
          <span className="dash-figure-of">of {cameras.length}</span>
          {cameras.length > 0 && (
            <span className="dash-meter" aria-hidden="true">
              {cameras.map((camera) => (
                <i key={camera.id} className={isCameraCounting(camera.id, live) ? "dash-meter-on" : "dash-meter-off"} />
              ))}
            </span>
          )}
        </Value>
      </Figure>

      <Figure segment="entries" name="Total Entries" qualifier={range.from === today && single ? "recorded today" : `recorded ${rangePhrase(range, today)}`}>
        <Value loading={loading} reveal={reveal} missing={entriesUnavailable ? "Unavailable for these cameras" : null}>
          {summary && !entriesUnavailable ? count(summary.entries) : "—"}
        </Value>
      </Figure>

      <Figure segment="occupancy" name="Live Occupancy" qualifier="current visitor inside">
        <Value loading={loading} reveal={reveal} missing={live?.state === "unavailable" ? "No camera is counting" : null}>
          {occupancy !== null ? count(occupancy) : "—"}
        </Value>
      </Figure>

      <Figure segment="peak" name="Peak Occupancy" qualifier="highest visitor record">
        <Value loading={loading} reveal={reveal} missing={peakValue === null ? "No visitors recorded yet" : null}>
          {peakValue !== null ? count(peakValue) : "—"}
        </Value>
      </Figure>
    </section>
  );
}
