import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { visitorInsightsQueryKey } from "@/app/hooks/useOperationalSync";
import { useAuthStore } from "@/app/store/authStore";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getVisitorInsights } from "@/shared/services/operationalSync";
import type { DateRange } from "@/shared/ui-kit";
import { highestPoint, niceAxisMax, peakLabel, peakPoints, peakSubtitle, peakWhen, peakWindowFor } from "../model/peakOccupancy";
import type { PlaceOption } from "../model/places";
import { PlacePicker } from "./PlacePicker";

type PeakOccupancyProps = {
  range: DateRange;
  today: Date;
  places: readonly PlaceOption[];
  monitoredCount: number;
};

/** The highest number of people inside, through the day (today) or day by day (longer ranges). */
export function PeakOccupancy({ range, today, places, monitoredCount }: PeakOccupancyProps) {
  const [enterpriseId, setEnterpriseId] = useState<string | null>(null);
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

  return (
    <section aria-labelledby="peak-occupancy-title" aria-busy={insightsQuery.isLoading} className="mt-auto min-w-0 border-t border-(--dash-rule) pt-4.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="peak-occupancy-title" className="font-display m-0 text-[22px] leading-tight font-bold text-(--tanaw-text)">
            Peak Occupancy
          </h2>
          <p className="mt-1 text-sm text-(--tanaw-text-secondary)">{peakSubtitle(peakWindow)}</p>
        </div>
        <PlacePicker places={places} value={enterpriseId} onChange={setEnterpriseId} monitoredCount={monitoredCount} />
      </div>

      {peakWindow === null ? null : insightsQuery.isLoading ? (
        <p role="status" className="mt-4 text-sm text-(--tanaw-text-secondary)">
          Loading camera counts…
        </p>
      ) : insightsQuery.isError ? (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-(--tanaw-text-secondary)">
          Camera counts could not be loaded.
          <button type="button" className="tanaw-dashboard-link" onClick={() => void insightsQuery.refetch()}>
            Try again
          </button>
        </p>
      ) : points.length === 0 || !peak ? (
        <p className="mt-4 text-sm text-(--tanaw-text-secondary)">No camera counts for {placeName} in this range yet.</p>
      ) : points.length === 1 ? (
        <p className="mt-4 text-sm text-(--tanaw-text)">
          <strong className="font-display text-2xl font-bold tabular-nums">{peak.value.toLocaleString("en-US")}</strong>{" "}
          <span className="text-(--tanaw-text-secondary)">most people inside {peakWhen(peak, peakWindow)}</span>
        </p>
      ) : (
        <figure className="m-0 mt-3">
          <p className="mb-1 text-xs text-(--tanaw-text-secondary)">
            <strong className="font-bold text-(--tanaw-text)">Peak {peak.value.toLocaleString("en-US")}</strong> {peakWhen(peak, peakWindow)}
          </p>
          <div className="h-36 w-full" role="img" aria-label={`Peak occupancy chart for ${placeName}. ${peakLabel(peak, peakWindow)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--dash-peak)" stopOpacity={0.38} />
                    <stop offset="100%" stopColor="var(--dash-peak)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--dash-rule)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tick={{ fontSize: 11.5, fill: "var(--tanaw-text-muted)" }} />
                <YAxis width={36} domain={[0, yMax]} ticks={[0, yMax / 2, yMax]} tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: "var(--tanaw-text-muted)" }} />
                <Tooltip
                  cursor={{ stroke: "var(--tanaw-text-muted)", strokeDasharray: "3 3" }}
                  formatter={(value) => [Number(value).toLocaleString("en-US"), "Most people inside"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--dash-rule)", background: "var(--tanaw-surface)", color: "var(--tanaw-text)", fontSize: 12 }}
                  labelStyle={{ color: "var(--tanaw-text-secondary)" }}
                />
                <Area type="monotone" dataKey="value" stroke="var(--dash-peak)" strokeWidth={2.5} fill={`url(#${gradientId})`} isAnimationActive={false} />
                <ReferenceLine x={peak.label} stroke="var(--tanaw-text)" strokeDasharray="3 3" ifOverflow="extendDomain" />
                <ReferenceDot x={peak.label} y={peak.value} r={5.5} fill="var(--tanaw-text)" stroke="var(--tanaw-page)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
    </section>
  );
}
