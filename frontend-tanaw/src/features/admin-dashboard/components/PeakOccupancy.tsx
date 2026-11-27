import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { visitorInsightsQueryKey } from "@/app/hooks/useOperationalSync";
import { useAuthStore } from "@/app/store/authStore";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getVisitorInsights } from "@/shared/services/operationalSync";
import { Skeleton, type DateRange } from "@/shared/ui-kit";
import { highestPoint, niceAxisMax, peakLabel, peakPoints, peakSubtitle, peakWhen, peakWindowFor } from "../model/peakOccupancy";
import type { PlaceOption } from "../model/places";
import { PlacePicker } from "./PlacePicker";

type PeakOccupancyProps = {
  range: DateRange;
  today: Date;
  places: readonly PlaceOption[];
  monitoredCount: number;
};

const axisTick = { fontSize: 12, fill: "var(--tanaw-chart-axis)" };

/** The chart's shape while camera counts load: its hairline grid and a skeleton where the line goes. */
function ChartSkeleton() {
  return (
    <div role="status" aria-label="Loading camera counts…" className="mt-3 flex flex-1 flex-col">
      {/* The readout line above the chart: 20px tall with 4px below it, as in .tanaw-dashboard-readout. */}
      <span className="mb-1 flex h-5 items-center">
        <Skeleton className="h-3.5 w-36" />
      </span>
      <div aria-hidden="true" className="tanaw-dashboard-chart-skeleton">
        <span className="tanaw-dashboard-chart-skeleton__rule" />
        <span className="tanaw-dashboard-chart-skeleton__rule" />
        <span className="tanaw-dashboard-chart-skeleton__rule" />
        <Skeleton className="absolute right-2 bottom-0 left-10 h-[62%] rounded-t-tanaw-md rounded-b-none" />
      </div>
      <span className="sr-only">Loading camera counts…</span>
    </div>
  );
}

/** The highest number of people inside, through the day (today) or day by day (longer ranges). */
export function PeakOccupancy({ range, today, places, monitoredCount }: PeakOccupancyProps) {
  const [enterpriseId, setEnterpriseId] = useState<string | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
  const token = useAuthStore((state) => state.token);
  const { timeFormat } = useSystemDisplayPreferences();
  const gradientId = useId().replace(/:/g, "");
  const peakWindow = peakWindowFor(range, today);
  const params = { range: peakWindow?.window ?? "today", ...(enterpriseId ? { enterpriseId } : {}) };
  const insightsQuery = useQuery({
    queryKey: [...visitorInsightsQueryKey, params],
    queryFn: () => getVisitorInsights(params),
    enabled: Boolean(token) && peakWindow !== null,
  });
  const points = useMemo(() => (peakWindow && insightsQuery.data ? peakPoints(insightsQuery.data.series, peakWindow, timeFormat) : []), [insightsQuery.data, peakWindow, timeFormat]);
  const peak = highestPoint(points);
  const yMax = niceAxisMax(peak?.value ?? 0);
  const placeName = places.find((place) => place.enterpriseId === enterpriseId)?.name ?? "All of San Pedro";
  const reading = pointed === null ? null : (points[pointed] ?? null);

  return (
    <section aria-labelledby="peak-occupancy-title" aria-busy={insightsQuery.isLoading} className="flex min-w-0 flex-1 flex-col border-t border-(--dash-rule) pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="peak-occupancy-title" className="tanaw-dashboard-heading">
            Peak Occupancy
          </h2>
          <p className="tanaw-dashboard-caption">{peakSubtitle(peakWindow)}</p>
        </div>
        <PlacePicker places={places} value={enterpriseId} onChange={setEnterpriseId} monitoredCount={monitoredCount} />
      </div>

      {peakWindow === null ? null : insightsQuery.isLoading ? (
        <ChartSkeleton />
      ) : insightsQuery.isError ? (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-(--tanaw-text-secondary)">
          Camera counts could not be loaded.
          <button type="button" className="tanaw-dashboard-link" onClick={() => void insightsQuery.refetch()}>
            Try again
          </button>
        </p>
      ) : points.length === 0 || !peak ? (
        // The chart's empty hairline grid with the message on it, so the section keeps its shape.
        <div className="tanaw-dashboard-fade tanaw-dashboard-chart-empty mt-3">
          <span aria-hidden="true" className="tanaw-dashboard-chart-skeleton__rule" />
          <span aria-hidden="true" className="tanaw-dashboard-chart-skeleton__rule" />
          <span aria-hidden="true" className="tanaw-dashboard-chart-skeleton__rule" />
          <p className="text-sm text-(--tanaw-text-secondary)">No camera counts for {placeName} in this range yet.</p>
        </div>
      ) : points.length === 1 ? (
        <p className="tanaw-dashboard-fade mt-4 text-sm text-(--tanaw-text)">
          <strong className="font-display text-2xl font-bold tabular-nums">{peak.value.toLocaleString("en-US")}</strong>{" "}
          <span className="text-(--tanaw-text-secondary)">most people inside {peakWhen(peak, peakWindow)}</span>
        </p>
      ) : (
        <figure key={`${enterpriseId ?? "all"}-${peakWindow.window}`} className="tanaw-dashboard-fade m-0 mt-3 flex flex-1 flex-col">
          {reading ? (
            <p className="tanaw-dashboard-readout">
              <span aria-hidden="true" className="tanaw-dashboard-key" />
              Most people inside <strong>{reading.value.toLocaleString("en-US")}</strong> {peakWhen(reading, peakWindow)}
            </p>
          ) : (
            <p className="tanaw-dashboard-readout">
              <span aria-hidden="true" className="tanaw-dashboard-key" />
              <span>
                <strong>Peak {peak.value.toLocaleString("en-US")}</strong> {peakWhen(peak, peakWindow)}
              </span>
            </p>
          )}
          <div className="h-36 min-h-36 w-full min-[1101px]:flex-1" role="img" aria-label={`Peak occupancy chart for ${placeName}. ${peakLabel(peak, peakWindow)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={points}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onMouseMove={(state) => {
                  const index = Number(state.activeTooltipIndex);
                  setPointed(state.activeTooltipIndex != null && Number.isInteger(index) ? index : null);
                }}
                onMouseLeave={() => setPointed(null)}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--dash-peak)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--dash-peak)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--tanaw-chart-grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tick={axisTick} />
                <YAxis width={36} domain={[0, yMax]} ticks={[0, yMax / 2, yMax]} tickLine={false} axisLine={false} tick={axisTick} />
                {/* Pointing at a period names it in the readout above; no tooltip box. */}
                <Tooltip cursor={{ stroke: "var(--tanaw-chart-connector)", strokeDasharray: "3 3" }} content={() => null} />
                <Area type="monotone" dataKey="value" stroke="var(--dash-peak)" strokeWidth={2.25} fill={`url(#${gradientId})`} isAnimationActive={false} activeDot={{ r: 4.5, fill: "var(--dash-peak)", stroke: "var(--tanaw-page)", strokeWidth: 2 }} />
                <ReferenceLine x={peak.label} stroke="var(--tanaw-chart-connector)" strokeDasharray="3 3" ifOverflow="extendDomain" />
                <ReferenceDot x={peak.label} y={peak.value} r={5} fill="var(--tanaw-text)" stroke="var(--tanaw-page)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
    </section>
  );
}
