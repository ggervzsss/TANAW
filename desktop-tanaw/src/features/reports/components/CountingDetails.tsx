import type { Metrics } from "../../../types/enterprise";

export function CountingDetails({ metrics }: { metrics: Metrics }) {
  const data = metrics.counting;
  if (!data) return null;
  const coverage = data.coverage_ratio > 0 && data.coverage_ratio < 0.01 ? "<1" : Math.round(data.coverage_ratio * 100);
  return (
    <section
      aria-label="Establishment counting basis"
      className="space-y-3 rounded-xl border border-emerald-800/15 bg-emerald-50/40 p-4 text-xs text-slate-700 dark:border-emerald-300/20 dark:bg-emerald-400/5 dark:text-slate-300"
    >
      <p className="font-semibold text-emerald-900 dark:text-emerald-200">One establishment total from both camera modes</p>
      <p>People recognized across cameras count once each day. This period adds those daily estimates; someone returning on another day can contribute again.</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt>Observed arrivals</dt>
        <dd className="text-right tabular-nums">{metrics.entries?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Observed departures</dt>
        <dd className="text-right tabular-nums">{metrics.exits?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Peak simultaneous occupancy</dt>
        <dd className="text-right tabular-nums">{metrics.peak?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Observation coverage</dt>
        <dd className="text-right tabular-nums">{coverage}% of period</dd>
        <dt>Unresolved observations</dt>
        <dd className="text-right tabular-nums">{data.unresolved_observations.toLocaleString()}</dd>
      </dl>
      {(data.reconciliation_state === "partial" || data.identification_state === "partial" || data.movement_state === "partial") && (
        <p>This report contains partial estimates. Missing observations and unresolved matches are reflected in its coverage and counting notes.</p>
      )}
      {data.source_breakdown?.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Camera evidence</summary>
          <p className="my-2">These measurements can include the same people. They explain the total and must not be added together.</p>
          <ul className="space-y-2">
            {data.source_breakdown.map((source) => (
              <li key={source.camera_id}>
                {source.camera_name}: {source.unique_count.toLocaleString()} daily visitor observations, {source.qualified_observations.toLocaleString()} qualifying records.
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
