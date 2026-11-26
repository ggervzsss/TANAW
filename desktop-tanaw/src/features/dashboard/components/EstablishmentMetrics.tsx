import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import type { Camera } from "../../../types/enterprise";
import type { EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { DashboardRange, TrafficPoint } from "../types/dashboard";
import { joinNames, shortTimeSpan } from "../utils/camera-status";
import { isSingleDay, rangePhrase, shortDate, weekdayName } from "../utils/dashboard-range";
import { isCameraCounting } from "../utils/establishment";

type MetricsProps = {
  cameras: Camera[];
  summary: EstablishmentSummary | null;
  live: EstablishmentLive | null;
  points: TrafficPoint[];
  change: { text: string | null; percent: number | null };
  range: DashboardRange;
  today: string;
  loading: boolean;
  /** "Parking Area not counted since 3:10 PM", when a camera stopped during the range. */
  outageNote: string | null;
  /** "a few seconds ago" or "7:41 PM". */
  updatedLabel: string;
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

function Value({ loading, children }: { loading: boolean; children: ReactNode }) {
  if (loading) return <span className="design-skeleton dash-figure-skeleton" aria-hidden="true" />;
  return <strong className="dash-figure-value">{children}</strong>;
}

function NoteSkeleton() {
  return <span className="design-skeleton dash-note-skeleton" aria-hidden="true" />;
}

/** The period with the most visitors inside at once, for the Peak Occupancy note. */
function peakPeriod(points: TrafficPoint[]) {
  let best: TrafficPoint | null = null;
  for (const point of points) if (point.occupancy !== null && point.occupancy > 0 && (!best || point.occupancy > (best.occupancy ?? 0))) best = point;
  return best;
}

export function EstablishmentMetrics({ cameras, summary, live, points, change, range, today, loading, outageNote, updatedLabel }: MetricsProps) {
  const counting = cameras.filter((camera) => isCameraCounting(camera.id, live));
  const stopped = live ? cameras.filter((camera) => !isCameraCounting(camera.id, live)) : [];
  const entriesUnavailable = summary?.movement_state === "unavailable";
  const single = isSingleDay(range);
  const changeTone = change.percent !== null && Math.abs(change.percent) >= 2 ? (change.percent > 0 ? " dash-note-up" : " dash-note-down") : "";
  const peakValue = summary?.peak_occupancy ?? null;
  const peak = peakPeriod(points);
  const peakNote = !peakValue ? "No visitors recorded yet" : peak ? (single ? `From ${shortTimeSpan(...(peak.period.split(" to ") as [string, string]))}` : `Reached on ${weekdayName(peak.key)}, ${shortDate(peak.key)}`) : `Highest ${rangePhrase(range, today)}`;

  return (
    <section className="dash-figures" data-unified-metrics-header aria-label="Enterprise analytics summary" aria-busy={loading}>
      <Figure segment="cameras" name="Cameras" qualifier="counting right now" tone={stopped.length ? "alert" : undefined}>
        <Value loading={loading}>
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
        {loading ? (
          <NoteSkeleton />
        ) : (
          <p className={`dash-figure-note${stopped.length ? " dash-note-alert" : ""}`}>
            <span className={`dash-dot ${cameras.length === 0 ? "dash-dot-off" : stopped.length ? "dash-dot-alert" : "dash-dot-live"}`} aria-hidden="true" />
            {cameras.length === 0 ? "No cameras added yet" : stopped.length ? `${joinNames(stopped.map((camera) => camera.name))} not counting` : "All cameras counting"}
          </p>
        )}
      </Figure>

      <Figure segment="entries" name="Total Entries" qualifier={range.from === today && single ? "recorded today" : `recorded ${rangePhrase(range, today)}`}>
        <Value loading={loading}>{summary && !entriesUnavailable ? count(summary.entries) : "—"}</Value>
        {loading && <NoteSkeleton />}
        {!loading && entriesUnavailable && <p className="dash-figure-note">Unavailable for these cameras</p>}
        {!loading && !entriesUnavailable && change.text && (
          <p className={`dash-figure-note${changeTone}`}>
            {changeTone === " dash-note-up" && <ArrowUp size={15} aria-hidden="true" />}
            {changeTone === " dash-note-down" && <ArrowDown size={15} aria-hidden="true" />}
            {change.text}
          </p>
        )}
        {!loading && outageNote && <p className="dash-figure-note dash-note-muted">{outageNote}</p>}
      </Figure>

      <Figure segment="occupancy" name="Live Occupancy" qualifier="current visitor inside">
        <Value loading={loading}>{live?.occupancy !== null && live?.occupancy !== undefined ? count(live.occupancy) : "—"}</Value>
        {loading ? (
          <NoteSkeleton />
        ) : (
          <p className="dash-figure-note">
            <span className={`dash-dot ${live?.state === "unavailable" ? "dash-dot-off" : "dash-dot-live"}`} aria-hidden="true" />
            {live?.state === "unavailable" ? "No camera is counting" : `Live, updated ${updatedLabel}`}
          </p>
        )}
      </Figure>

      <Figure segment="peak" name="Peak Occupancy" qualifier="highest visitor record">
        <Value loading={loading}>{peakValue !== null ? count(peakValue) : "—"}</Value>
        {loading ? <NoteSkeleton /> : <p className="dash-figure-note">{peakNote}</p>}
      </Figure>
    </section>
  );
}
