import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis, type MouseHandlerDataParam } from "recharts";
import { usePhoneWidth } from "../hooks/useMediaQuery";
import { formatCompact, formatCount, type Trend } from "../model/enterpriseTrend";

type PeakBubbleProps = { viewBox?: { x?: number; y?: number }; text: string };

const axisTick = { fontSize: 12, fill: "var(--tanaw-chart-axis)" };

/** The busiest point's value in a small bubble above the line. */
function PeakBubble({ viewBox, text }: PeakBubbleProps) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const width = Math.max(34, text.length * 7.4 + 16);
  return (
    <g transform={`translate(${x}, ${y - 34})`}>
      <rect x={-width / 2} y={0} width={width} height={22} rx={11} fill="var(--ae-peak)" />
      <path d="M -5 21 L 0 27 L 5 21 Z" fill="var(--ae-peak)" />
      <text x={0} y={15} textAnchor="middle" fontSize={12} fontWeight={650} fill="var(--ae-peak-text)">
        {text}
      </text>
    </g>
  );
}

/**
 * The Enterprise Details trend as a line over a soft area: one point per hour, day or month, the
 * busiest one marked with its value. Days without camera updates leave a gap, never a false 0.
 * Pointing at a period names its figure as keyed text above the chart, not in a box.
 */
export function TrendChart({ trend, empty }: { trend: Trend | null; empty: string }) {
  const gradientId = useId().replace(/:/g, "");
  const [pointed, setPointed] = useState<number | null>(null);
  const phone = usePhoneWidth();
  // Pointing (mouse) or tapping and dragging (touch) names that period's figure above the chart; on
  // touch the reading stays after the finger lifts, so it can be read.
  const read = (state: MouseHandlerDataParam) => {
    const index = Number(state.activeTooltipIndex);
    setPointed(state.activeTooltipIndex != null && Number.isInteger(index) ? index : null);
  };
  const points = useMemo(() => trend?.bars.map((bar) => ({ key: bar.key, value: bar.value })) ?? [], [trend]);
  const labels = useMemo(() => new Map(trend?.bars.map((bar) => [bar.key, bar]) ?? []), [trend]);

  if (!trend || !trend.bars.some((bar) => bar.value !== null)) {
    return <p className="ae-fade mt-4.5 flex min-h-40 items-center border-b border-(--tanaw-border-soft) text-sm text-(--tanaw-text-secondary)">{empty}</p>;
  }
  const format = trend.period === "monthly" ? formatCompact : formatCount;
  const busiest = trend.busiest?.value != null ? trend.busiest : null;
  const reading = pointed === null ? null : (trend.bars[pointed] ?? null);

  return (
    <figure key={`${trend.period}-${trend.title}`} className="ae-fade m-0 mt-4" aria-labelledby="trend-title">
      {/* Keeps one height whether or not a period is pointed at, so the plot never jumps. */}
      <p aria-hidden="true" className="ae-readout">
        {reading && (
          <>
            <span className="ae-key" />
            {reading.fullLabel}
            <strong>{reading.value === null ? "No data" : formatCount(reading.value)}</strong>
            {reading.value === null ? null : trend.unit}
          </>
        )}
      </p>
      <div aria-hidden="true" className="ae-trend-chart h-65 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 40, right: 8, bottom: 0, left: 0 }}
            onMouseMove={read}
            onClick={read}
            onTouchStart={read}
            onTouchMove={read}
            onMouseLeave={() => setPointed(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ae-bar)" stopOpacity={0.26} />
                <stop offset="100%" stopColor="var(--ae-bar)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--tanaw-chart-grid)" />
            <XAxis
              dataKey="key"
              // Phones label as many periods as fit without overlap, always the first and last.
              interval={phone && points.length > 6 ? "preserveStartEnd" : 0}
              minTickGap={phone ? 10 : 5}
              padding={phone ? { left: 12, right: 12 } : { left: 24, right: 24 }}
              tickLine={false}
              axisLine={{ stroke: "var(--tanaw-chart-grid)" }}
              tickMargin={8}
              tickFormatter={(key: string) => labels.get(key)?.axisLabel ?? ""}
              tick={axisTick}
            />
            <YAxis width={phone ? 44 : 56} allowDecimals={false} domain={[0, "auto"]} tickLine={false} axisLine={false} tickFormatter={(value: number) => format(value)} tick={axisTick} />
            <Tooltip cursor={{ stroke: "var(--tanaw-chart-connector)", strokeDasharray: "3 3" }} content={() => null} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--ae-peak)"
              strokeWidth={2.25}
              fill={`url(#${gradientId})`}
              connectNulls={false}
              dot={points.length <= 31 ? { r: 3.5, fill: "var(--ae-peak)", stroke: "var(--tanaw-page)", strokeWidth: 1.5 } : false}
              activeDot={{ r: 5, fill: "var(--ae-peak)", stroke: "var(--tanaw-page)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {busiest && (
              <ReferenceDot
                x={busiest.key}
                y={busiest.value ?? 0}
                r={5.5}
                fill="var(--ae-peak)"
                stroke="var(--tanaw-page)"
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
