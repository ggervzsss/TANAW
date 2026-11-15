type Props = { active?: boolean; label?: unknown; payload?: ReadonlyArray<{ name?: unknown; value?: unknown; dataKey?: unknown }> };

/** Shared by Dashboard charts only; series text stays readable on both themes. */
export function DashboardChartTooltip({ active, label, payload }: Props) {
  const values = payload?.filter((item) => item.value != null) ?? [];
  if (!active || !values.length) return null;
  return (
    <div className="dashboard-chart-tooltip" role="tooltip">
      <strong>{String(label ?? "")}</strong>
      {values.map((item, index) => (
        <div key={String(item.dataKey ?? index)}>
          <i data-series={String(item.dataKey)} aria-hidden="true" />
          <span>{String(item.name ?? "Visitors")}</span>
          <b>{typeof item.value === "number" ? item.value.toLocaleString() : String(item.value)}</b>
        </div>
      ))}
    </div>
  );
}
