import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatCount, type Trend } from "../model/enterpriseTrend";

type PeakBubbleProps = { viewBox?: { x?: number; y?: number }; text: string };

/** The busiest point's value in a small Civic Green bubble above the line. */
function PeakBubble({ viewBox, text }: PeakBubbleProps) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const width = Math.max(34, text.length * 7.4 + 16);
  return (
    <g transform={`translate(${x}, ${y - 34})`}>
      <rect x={-width / 2} y={0} width={width} height={22} rx={11} fill="var(--ae-peak)" />
      <path d="M -5 21 L 0 27 L 5 21 Z" fill="var(--ae-peak)" />
      <text x={0} y={15} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ae-peak-text)">
        {text}
      </text>
    </g>
  );
}

/**
 * The Enterprise Details trend as a line over a soft area: one point per hour, day or month, the
 * busiest one marked with its value. Days without camera updates leave a gap, never a false 0.
 */
export function TrendChart({ trend, empty }: { trend: Trend | null; empty: string }) {
  const gradientId = useId().replace(/:/g, "");
  const points = useMemo(() => trend?.bars.map((bar) => ({ key: bar.key, value: bar.value })) ?? [], [trend]);
  const labels = useMemo(() => new Map(trend?.bars.map((bar) => [bar.key, bar]) ?? []), [trend]);

  if (!trend || !trend.bars.some((bar) => bar.value !== null)) {
    return <p className="mt-4.5 flex min-h-40 items-center border-b border-(--tanaw-border-soft) text-sm text-(--tanaw-text-secondary)">{empty}</p>;
  }
  const format = trend.period === "monthly" ? formatCompact : formatCount;
  const busiest = trend.busiest?.value != null ? trend.busiest : null;

  return (
    <figure className="m-0 mt-4.5" aria-labelledby="trend-title">
      <div aria-hidden="true" className="ae-trend-chart h-65 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 40, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ae-bar)" stopOpacity={0.42} />
                <stop offset="100%" stopColor="var(--ae-bar)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--tanaw-border-soft)" />
            <XAxis
              dataKey="key"
              interval={0}
              padding={{ left: 24, right: 24 }}
              tickLine={false}
              axisLine={{ stroke: "var(--tanaw-border-soft)" }}
              tickMargin={8}
              tickFormatter={(key: string) => labels.get(key)?.axisLabel ?? ""}
              tick={{ fontSize: 12, fill: "var(--tanaw-text-muted)" }}
            />
            <YAxis width={56} allowDecimals={false} domain={[0, "auto"]} tickLine={false} axisLine={false} tickFormatter={(value: number) => format(value)} tick={{ fontSize: 12, fill: "var(--tanaw-text-muted)" }} />
            <Tooltip
              cursor={{ stroke: "var(--tanaw-text-muted)", strokeDasharray: "3 3" }}
              labelFormatter={(key) => labels.get(String(key))?.fullLabel ?? String(key)}
              formatter={(value) => [`${formatCount(Number(value))} ${trend.unit}`, null]}
              separator=""
              contentStyle={{ borderRadius: 10, border: "1px solid var(--tanaw-border-soft)", background: "var(--tanaw-surface)", color: "var(--tanaw-text)", fontSize: 12 }}
              labelStyle={{ color: "var(--tanaw-text-secondary)", fontWeight: 600 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--ae-peak)"
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              connectNulls={false}
              dot={points.length <= 31 ? { r: 4, fill: "var(--ae-peak)", stroke: "var(--tanaw-surface)", strokeWidth: 1.5 } : false}
              activeDot={{ r: 5.5, fill: "var(--ae-peak)", stroke: "var(--tanaw-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {busiest && (
              <ReferenceDot
                x={busiest.key}
                y={busiest.value ?? 0}
                r={6}
                fill="var(--ae-peak)"
                stroke="var(--tanaw-surface)"
                strokeWidth={2.5}
                label={<PeakBubble text={format(busiest.value ?? 0)} />}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>
          {trend.title}: {trend.unit}
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {trend.bars.map((bar) => (
            <tr key={bar.key}>
              <th scope="row">{bar.fullLabel}</th>
              <td>{bar.value === null ? "No data" : `${formatCount(bar.value)} ${trend.unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
