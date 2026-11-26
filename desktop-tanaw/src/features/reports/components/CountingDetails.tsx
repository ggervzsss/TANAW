import type { Metrics } from "../../../types/enterprise";

export function CountingDetails({ metrics }: { metrics: Metrics }) {
  const data = metrics.counting;
  if (!data) return null;
  const coverage = data.coverage_ratio > 0 && data.coverage_ratio < 0.01 ? "<1" : Math.round(data.coverage_ratio * 100);
  return (
    <section aria-label="Establishment counting basis" className="report-counting-basis">
      <p className="report-counting-basis__title">One establishment total from both camera modes</p>
      <p>People recognized across cameras count once each day. This period adds those daily estimates; someone returning on another day can contribute again.</p>
      <dl>
        <dt>Observed arrivals</dt>
        <dd>{metrics.entries?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Observed departures</dt>
        <dd>{metrics.exits?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Peak simultaneous occupancy</dt>
        <dd>{metrics.peak?.toLocaleString() ?? "Not measured"}</dd>
        <dt>Observation coverage</dt>
        <dd>{coverage}% of period</dd>
        <dt>Unresolved observations</dt>
        <dd>{data.unresolved_observations.toLocaleString()}</dd>
      </dl>
      {(data.reconciliation_state === "partial" || data.identification_state === "partial" || data.movement_state === "partial") && (
        <p>This report contains partial estimates. Missing observations and unresolved matches are reflected in its coverage and counting notes.</p>
      )}
      {data.source_breakdown?.length > 0 && (
        <details>
          <summary>Camera evidence</summary>
          <p>These measurements can include the same people. They explain the total and must not be added together.</p>
          <ul>
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
