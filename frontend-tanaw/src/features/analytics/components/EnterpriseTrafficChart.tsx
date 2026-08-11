import { Activity } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/shared/components/ui";
import type { StaffAnalyticsViewModel } from "../hooks";

type TrafficDatum = StaffAnalyticsViewModel["chartData"][number] & { range: [number, number] };
type TrafficTooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: TrafficDatum }> };
type AxisTickProps = { payload?: { value?: string }; x?: number; y?: number };
type MarkerProps = { cx?: number; cy?: number };

export function EnterpriseTrafficChart({ analytics }: { analytics: StaffAnalyticsViewModel }) {
  let emptyState = null;
  if (analytics.enterpriseLoading)
    emptyState = <EmptyState icon={Activity} title="Loading enterprises" description="Fetching registered enterprise accounts for analytics." minHeightClassName="min-h-72" />;
  else if (analytics.reportsLoading)
    emptyState = <EmptyState icon={Activity} title="Loading report intake" description="Fetching the latest enterprise report submissions." minHeightClassName="min-h-72" />;
  else if (analytics.chartData.length === 0)
    emptyState = (
      <EmptyState
        icon={Activity}
        title="No registered enterprises"
        description="Enterprise traffic comparisons will appear here once enterprise accounts are registered."
        minHeightClassName="min-h-72"
      />
    );

  const chartData: TrafficDatum[] = analytics.chartData.map((row) => ({
    ...row,
    range: [Math.min(row.entries, row.unique), Math.max(row.entries, row.unique)],
  }));
  const chartHeight = Math.max(330, chartData.length * 62 + 68);

  return (
    <section className="tanaw-dashboard-panel tanaw-traffic-card flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-sm">
      <header className="tanaw-dashboard-card-header flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Enterprise Traffic Comparison</h3>
          <p className="tanaw-dashboard-card-copy mt-1.5 text-xs leading-relaxed">Compare Total Entries and Unique Pax for every registered enterprise.</p>
        </div>
        <ChartLegend />
      </header>

      <div className="min-h-0 flex-1 p-5 pt-4">
        {emptyState ?? (
          <>
            <div
              className="tanaw-dashboard-scroll tanaw-traffic-chart-scroll max-h-112 overflow-y-auto pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
              tabIndex={0}
              aria-label="Scrollable enterprise traffic comparison chart"
            >
              <div style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    accessibilityLayer
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 16, right: 26, bottom: 12, left: 2 }}
                    role="img"
                    aria-label="Horizontal comparison of Total Entries and Unique Pax by enterprise"
                  >
                    <CartesianGrid horizontal={false} stroke="var(--tanaw-chart-grid)" strokeDasharray="2 7" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--tanaw-chart-axis)" }} tickFormatter={formatAxisValue} domain={[0, "dataMax"]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} interval={0} tick={<EnterpriseAxisTick />} width={184} />
                    <Tooltip cursor={false} content={<TrafficTooltip />} />
                    <Bar dataKey="range" name="Comparison span" barSize={4} fill="var(--tanaw-chart-connector)" radius={999} isAnimationActive={false} />
                    <Scatter dataKey="entries" name="Total Entries" fill="var(--tanaw-chart-primary)" shape={<EntryMarker />} isAnimationActive={false} />
                    <Scatter dataKey="unique" name="Unique Pax" fill="var(--tanaw-chart-secondary)" shape={<UniqueMarker />} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <TrafficDataTable rows={chartData} />
          </>
        )}
      </div>
    </section>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold" aria-label="Chart legend">
      <span className="tanaw-dashboard-card-copy inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-(--tanaw-chart-primary)" aria-hidden="true" /> Total Entries
      </span>
      <span className="tanaw-dashboard-card-copy inline-flex items-center gap-2">
        <span className="h-3 w-3 rotate-45 rounded-[3px] bg-(--tanaw-chart-secondary)" aria-hidden="true" /> Unique Pax
      </span>
    </div>
  );
}

function TrafficTooltip({ active, payload }: TrafficTooltipProps) {
  const row = payload?.find((item) => item.payload)?.payload;
  if (!active || !row) return null;

  return (
    <div className="tanaw-chart-tooltip min-w-48 rounded-xl border px-3.5 py-3 text-xs shadow-(--tanaw-shadow-raised)">
      <p className="font-semibold text-(--tanaw-chart-tooltip-text)">{row.name}</p>
      <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-5 gap-y-2">
        <dt className="flex items-center gap-2 text-(--tanaw-secondary-text)">
          <span className="h-2.5 w-2.5 rounded-full bg-(--tanaw-chart-primary)" aria-hidden="true" /> Total Entries
        </dt>
        <dd className="font-mono font-bold text-(--tanaw-chart-tooltip-text) tabular-nums">{row.entries.toLocaleString()}</dd>
        <dt className="flex items-center gap-2 text-(--tanaw-secondary-text)">
          <span className="h-2.5 w-2.5 rotate-45 rounded-xs bg-(--tanaw-chart-secondary)" aria-hidden="true" /> Unique Pax
        </dt>
        <dd className="font-mono font-bold text-(--tanaw-chart-tooltip-text) tabular-nums">{row.unique.toLocaleString()}</dd>
      </dl>
    </div>
  );
}

function EnterpriseAxisTick({ payload, x = 0, y = 0 }: AxisTickProps) {
  const lines = splitEnterpriseName(payload?.value ?? "");
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{payload?.value}</title>
      <text x={-10} y={lines.length === 1 ? 4 : -3} textAnchor="end" fill="var(--tanaw-chart-label)" fontSize={11.5} fontWeight={600}>
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={-10} dy={index === 0 ? 0 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function EntryMarker({ cx = 0, cy = 0 }: MarkerProps) {
  return <circle cx={cx} cy={cy} r={7} fill="var(--tanaw-chart-primary)" stroke="var(--tanaw-chart-marker-stroke)" strokeWidth={2} />;
}

function UniqueMarker({ cx = 0, cy = 0 }: MarkerProps) {
  return (
    <rect x={cx - 6} y={cy - 6} width={12} height={12} rx={2.5} transform={`rotate(45 ${cx} ${cy})`} fill="var(--tanaw-chart-secondary)" stroke="var(--tanaw-chart-marker-stroke)" strokeWidth={2} />
  );
}

function TrafficDataTable({ rows }: { rows: TrafficDatum[] }) {
  return (
    <table className="sr-only">
      <caption>Enterprise Traffic Comparison data</caption>
      <thead>
        <tr>
          <th>Enterprise</th>
          <th>Total Entries</th>
          <th>Unique Pax</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th>{row.name}</th>
            <td>{row.entries}</td>
            <td>{row.unique}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function splitEnterpriseName(name: string) {
  if (name.length <= 24) return [name];
  const words = name.split(/\s+/);
  const firstLine: string[] = [];
  const secondLine: string[] = [];
  let firstLength = 0;

  words.forEach((word) => {
    if (firstLength + word.length + (firstLine.length > 0 ? 1 : 0) <= 22 || firstLine.length === 0) {
      firstLine.push(word);
      firstLength += word.length + (firstLine.length > 1 ? 1 : 0);
    } else {
      secondLine.push(word);
    }
  });

  const second = secondLine.join(" ");
  return [firstLine.join(" "), second.length > 27 ? `${second.slice(0, 26).trimEnd()}…` : second];
}

function formatAxisValue(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return value.toLocaleString();
}
