import { Activity, AlertTriangle, LogIn, LogOut, Users, type LucideIcon } from "lucide-react";
import { Skeleton, Tooltip } from "../../../ui-kit";
import type { Camera } from "../../../types/enterprise";
import type { MlAreaState, MlCounts, MlHealth } from "../services/ml-service";
import { CameraMetricsLineField } from "./CameraMetricsLineField";

type CameraLiveMetricsProps = {
  activeCam: Camera;
  runtimeReady: boolean;
  /** The first readings for this camera are on their way; values show placeholders. */
  loading?: boolean;
  area?: MlAreaState | null;
  counts: MlCounts;
  health: MlHealth | null;
};

export function CameraLiveMetrics({ activeCam, runtimeReady, loading = false, area, counts, health }: CameraLiveMetricsProps) {
  const openSpace = activeCam.analysisMode === "open_space";
  const occupancy = openSpace
    ? (runtimeReady && area?.available ? area.presence : null)
    : (runtimeReady ? counts.occupancy : null);
  const entry = runtimeReady && !openSpace ? counts.entry : null;
  const exit = runtimeReady && !openSpace ? counts.exit : null;
  const identificationAvailable = runtimeReady && openSpace && area?.unique_visitors_available;
  const visitors = openSpace
    ? (identificationAvailable ? area.unique_visitors : null)
    : (runtimeReady ? (health?.estimated_unique_count ?? health?.confirmed_unique_count) : null);
  const pendingUniqueEntries = runtimeReady ? (health?.pending_unique_entries ?? 0) : 0;
  const ambienceTone = getAmbienceTone({ occupancy, entry, exit, visitors }, counts, activeCam.status, runtimeReady);

  return (
    <section className="camera-live-metrics" aria-labelledby="camera-metrics-heading" aria-busy={loading || undefined}>
      <header className="camera-metrics-heading">
        <Activity size={18} aria-hidden="true" />
        <h4 id="camera-metrics-heading">Live Metrics</h4>
      </header>
      {openSpace ? (
        <>
          <div className="camera-metrics-grid" data-mode="open-space">
            <Metric loading={loading} icon={Users} label="Live Occupancy" value={occupancy} detail="People in this zone"
              unavailable="Live observations unavailable" tone="occupancy" tooltip="People currently observed inside this camera’s monitored zone." />
            <Metric loading={loading} icon={Users} label="Unique Visitors" value={visitors} detail="Estimated today in this zone"
              unavailable="Identification unavailable" tone="visitors"
              tooltip="Estimated distinct visitors observed in this zone today. Repeat matches count once, and uncertain identities are excluded." />
          </div>
          {!activeCam.openSpace && <p className="camera-metrics-note">Zone setup required. Draw a monitored area in Settings to count visitors in this zone.</p>}
        </>
      ) : (
        <>
          <div className="camera-metrics-grid" data-mode="entrance-exit">
            <Metric loading={loading} icon={LogIn} label="Entry" value={entry} tone="entry"
              tooltip="Visitors counted after crossing this camera’s configured entry line." />
            <Metric loading={loading} icon={LogOut} label="Exit" value={exit} tone="exit"
              tooltip="Visitors counted after crossing this camera’s configured exit line." />
            <Metric loading={loading} icon={Users} label="Establishment Occupancy" value={occupancy} detail="People inside"
              tone="occupancy" tooltip="People inside, counted across all Entry / Exit cameras. The Dashboard also adds people in Open Space areas." />
            <Metric loading={loading} icon={Users} label="Estimated Visitors" value={visitors}
              tone="visitors" tooltip="Confirmed and degraded unique estimates attributed to this camera. Provisional identities are excluded." />
          </div>
          {pendingUniqueEntries > 0 && (
            <p className="camera-metrics-note">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{pendingUniqueEntries} provisional {pendingUniqueEntries === 1 ? "identity is" : "identities are"} excluded from the visitor estimate pending a stronger match.</span>
            </p>
          )}
        </>
      )}
      <CameraMetricsLineField tone={ambienceTone} />
    </section>
  );
}

type MetricValue = number | null | undefined;

function getAmbienceTone(
  { occupancy, entry, exit, visitors }: { occupancy: MetricValue; entry: MetricValue; exit: MetricValue; visitors: MetricValue },
  counts: MlCounts,
  cameraStatus: Camera["status"],
  runtimeReady: boolean,
) {
  if (!runtimeReady) return "muted";
  const warningStates: readonly string[] = ["degraded", "reconnecting", "failed", "error", "offline"];
  if (counts.error || warningStates.includes(counts.status) || warningStates.includes(cameraStatus)) return "attention";
  if (!isMetricNumber(occupancy) || occupancy < 0 || ["starting", "connecting"].includes(counts.status)) return "muted";
  if (!counts.running) return "calm";

  // Totals provide context while current occupancy drives the visual.
  const crossings = Math.min(2, (activityCount(entry) + activityCount(exit)) / 40);
  const visitorContext = Math.min(1, activityCount(visitors) / 30);
  const activity = occupancy + crossings + visitorContext;
  if (activity >= 15) return "high";
  return activity >= 5 ? "moderate" : "calm";
}

function activityCount(value: MetricValue) {
  return isMetricNumber(value) ? Math.max(0, value) : 0;
}

function isMetricNumber(value: MetricValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Each count keeps one hue: Entry green, Exit rose, occupancy blue and visitors Seal Gold. */
type MetricTone = "entry" | "exit" | "occupancy" | "visitors";

type MetricProps = {
  detail?: string;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  tone: MetricTone;
  tooltip: string;
  unavailable?: string;
  value: MetricValue;
};

/** One tinted tile: the name, what it counts (or why it is unavailable), then the figure. */
function Metric({ detail, icon: Icon, label, loading = false, tone, tooltip, unavailable = "Unavailable", value }: MetricProps) {
  const available = isMetricNumber(value);
  const placeholder = loading && !available;
  return (
    <div className="camera-metric" data-tone={tone}>
      <div className="camera-metric-label">
        <h5>{label}</h5>
        <Tooltip ariaLabel={`About ${label.toLowerCase()}`} content={tooltip}>
          <Icon size={16} aria-hidden="true" />
        </Tooltip>
      </div>
      {placeholder ? (
        <>
          {detail && <Skeleton className="camera-metric-skeleton-detail" />}
          <Skeleton className="camera-metric-skeleton" />
        </>
      ) : (
        <>
          {(detail || !available) && <p>{available ? detail : unavailable}</p>}
          <div className="camera-metric-value" aria-hidden={!available}>{available ? value.toLocaleString("en-PH") : "—"}</div>
        </>
      )}
    </div>
  );
}
