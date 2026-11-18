import type { DeveloperSettings } from "../../preferences/developer-settings";
import type { MlDetectionTrack } from "../services/ml-service.types";

type TrackLabelContext = {
  analysisMode: "entrance_exit" | "open_space";
  /** Open Space: whether the person has an active visit in the monitored area. */
  inMonitoredArea: boolean;
  developer: DeveloperSettings;
};

/**
 * Lines shown on one person's box. Operators see a plain box; developer mode labels the box with
 * what TANAW believes about that exact person, so a wrong match or estimate is easy to spot.
 */
export function trackLabelLines(track: MlDetectionTrack, { analysisMode, inMonitoredArea, developer }: TrackLabelContext): string[] {
  const lines: string[] = [];
  if (developer.detectionLabels) {
    const id = track.track_id > 0 ? `#${track.track_id}${track.source_track_id !== track.track_id ? ` (src ${track.source_track_id})` : ""}` : "Unconfirmed";
    const state = analysisMode === "open_space" ? (inMonitoredArea ? "In monitored area" : "Observing") : track.direction === "entry" ? "Entry" : track.direction === "exit" ? "Exit" : "Tracking";
    lines.push(`${id} · ${state} · ${Math.round(track.confidence * 100)}%`);
  }
  if (developer.demographics) lines.push(sexEstimateLabel(track));
  return lines;
}

export function sexEstimateLabel(track: MlDetectionTrack) {
  const estimate = track.sex_estimate;
  if (track.track_id <= 0) return "Sex: waiting for tracking";
  if (!estimate) return "Sex: model unavailable";
  if (estimate.female_probability == null) return "Sex: needs a clearer view";
  const female = estimate.female_probability;
  const side = female >= 0.5 ? "Female" : "Male";
  const certainty = Math.round(Math.max(female, 1 - female) * 100);
  return `${side} ${certainty}% · evidence ${estimate.evidence_weight.toFixed(1)}`;
}
