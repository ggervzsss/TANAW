import type { Metrics } from "../../../types/enterprise";

export function countingNotes(metrics: Metrics): string {
  const data = metrics.counting;
  if (!data) return "";
  const value = (number: number | null) => (number === null ? "not measured" : number.toLocaleString("en-US"));
  const coverage = data.coverage_ratio > 0 && data.coverage_ratio < 0.01 ? "<1" : String(Math.round(data.coverage_ratio * 100));
  return [
    "Counting basis: one establishment total from Entrance / Exit and Open Space observations.",
    "Visitor total adds daily estimates, with recognized people counted once across cameras each day. A person visiting on different days can contribute again; this is not month-wide person identification.",
    `Observed arrivals: ${value(metrics.entries)}. Observed departures: ${value(metrics.exits)}. Peak simultaneous occupancy: ${value(metrics.peak)}.`,
    `Observation coverage: ${coverage}% of the selected period. Unresolved observations: ${data.unresolved_observations}. Counting state: ${data.reconciliation_state}.`,
    "Camera evidence can overlap and is not added to the establishment total.",
    ...data.source_breakdown.map(
      (source) => `${source.camera_name}: ${source.unique_count.toLocaleString("en-US")} daily visitor observations, ${source.qualified_observations.toLocaleString("en-US")} qualifying records.`,
    ),
    ...(data.occupancy_corrections ?? []).map((item) => `Occupancy recount at ${item.recorded_at}: ${item.old_occupancy} to ${item.new_occupancy}. Reason: ${item.reason}.`),
    `Counting policy: ${data.policy_version}. Snapshot: ${data.snapshot_version}.`,
  ].join("\n");
}
