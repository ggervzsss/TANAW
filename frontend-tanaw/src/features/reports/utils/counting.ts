type SourceEvidence = { camera_id: number; camera_name: string; unique_count: number; qualified_observations: number };
export type CountingSnapshot = {
  snapshot_version: string;
  counting_basis: string;
  coverage_ratio: number;
  unresolved_observations: number;
  reconciliation_state: string;
  movement_state: string;
  identification_state: string;
  entries: number;
  exits: number;
  peak_occupancy: number | null;
  source_breakdown: SourceEvidence[];
};

export function getCountingSnapshot(value: unknown): CountingSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as CountingSnapshot;
  if (
    data.counting_basis !== "sum_of_daily_establishment_unique_visitors" ||
    typeof data.snapshot_version !== "string" ||
    typeof data.coverage_ratio !== "number" ||
    !Array.isArray(data.source_breakdown)
  )
    return null;
  return data;
}

export function measuredCount(value: number | string | null | undefined) {
  return value == null ? "Not measured" : typeof value === "number" ? value.toLocaleString("en-US") : value;
}

export function countingNotes(value: unknown): string[] {
  const data = getCountingSnapshot(value);
  if (!data) return [];
  const coverage = data.coverage_ratio > 0 && data.coverage_ratio < 0.01 ? "<1" : Math.round(data.coverage_ratio * 100);
  return [
    "One establishment total reconciles Entrance / Exit and Open Space observations. Recognized visitors count once across cameras each day. The period adds daily estimates; people returning on different dates may contribute again.",
    `Arrivals: ${measuredCount(data.movement_state === "unavailable" ? null : data.entries)}. Departures: ${measuredCount(data.movement_state === "unavailable" ? null : data.exits)}. Peak simultaneous occupancy: ${measuredCount(data.peak_occupancy)}.`,
    `Observation coverage: ${coverage}% of period. Unresolved observations: ${data.unresolved_observations}. Counting: ${data.reconciliation_state}; movement: ${data.movement_state}; identification: ${data.identification_state}.`,
    "Camera evidence can contain the same visitors. Do not add it to the establishment total.",
    ...data.source_breakdown.map(
      (source) => `${source.camera_name}: ${source.unique_count.toLocaleString("en-US")} daily visitor observations; ${source.qualified_observations.toLocaleString("en-US")} qualifying records.`,
    ),
    `Snapshot: ${data.snapshot_version}`,
  ];
}
