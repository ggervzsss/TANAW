import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import { useId } from "react";
import type { EstablishmentHourly, EstablishmentSummary } from "../../camera/services/ml-service";
import type { SystemTimeFormat } from "../../../utils/date-time";
import type { TrendFilter } from "../types/dashboard";
import { establishmentTrend, hourlyOccupancyTrend } from "../utils/establishment";
import { DashboardChartTooltip } from "./DashboardChartTooltip";

type Props = {
  summary: EstablishmentSummary | null;
  hourly: EstablishmentHourly | null;
  range: { start: string; end: string };
  filter: TrendFilter;
  timeFormat: SystemTimeFormat;
  unavailable: boolean;
};
export function EstablishmentTrendChart({ summary, hourly, range, filter, timeFormat, unavailable }: Props) {
  const reduceMotion = useReducedMotion();
  const gradientId = useId().replace(/:/g, "");
  const data = establishmentTrend(summary, range).map((point) => {
    const day = summary?.days.find((day) => day.business_date === point.date);
    const measured = day && (day.covered_ms > 0 || day.qualified_observations > 0) && day.movement_state !== "unavailable";
    return { ...point, entries: measured ? day.entries : null, exits: measured ? day.exits : null };
  });
  const trafficData: Array<{ label: string; entries: number | null; exits: number | null }> = data;
  // A single day reads better hour by hour than as one daily point.
  const hourlyOccupancy = filter === "Today" ? hourlyOccupancyTrend(hourly, timeFormat) : [];
  const byHour = hourlyOccupancy.length > 0;
  const occupancyData: Array<{ label: string; occupancy: number | null }> = byHour ? hourlyOccupancy : data;
  const hasOccupancy = occupancyData.some((point) => point.occupancy !== null);
  const hasMovement = trafficData.some((point) => point.entries != null || point.exits != null);
  const observedZero = hasOccupancy && data.every((point) => (point.visitors === null || point.visitors === 0) && (point.occupancy === null || point.occupancy === 0));
  const empty = (
    <div className="chart-empty" role="status">
      {unavailable ? "History unavailable. Check the local camera service." : "No observations available for this period."}
    </div>
  );
  // Points on a line chart sit on the plot edges unless the x-axis is padded; a point there is
  // half outside the hover area, so pointing at it shows no tooltip.
  const axes = (xPadding?: { left: number; right: number }) => (
    <>
      <CartesianGrid vertical={false} stroke="var(--enterprise-chart-grid)" strokeDasharray="3 5" />
      <XAxis dataKey="label" padding={xPadding} tickLine={false} axisLine={{ stroke: "var(--dashboard-chart-baseline)" }} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)" }} />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)" }} />
    </>
  );
  return (
    <div className="overview-charts">
      <section className="design-card overview-chart">
        <header>
          <h3>Visitor Traffic</h3>
          <p>
            Entries vs. Exits <span>· {filter === "Today" ? "today" : filter === "Week" ? "past 7 days" : "past 30 days"}</span>
          </p>
        </header>
        {hasMovement ? (
          <div className="overview-chart-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trafficData} accessibilityLayer role="img" aria-label={`${filter} visitor entries and exits`} margin={{ top: 16, right: 20, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={`${gradientId}-entries`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--dashboard-entry-highlight)" />
                    <stop offset="100%" stopColor="var(--enterprise-chart-entry)" />
                  </linearGradient>
                  <linearGradient id={`${gradientId}-exits`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--design-chart-exit)" />
                    <stop offset="100%" stopColor="var(--dashboard-exit-base)" />
                  </linearGradient>
                </defs>
                {axes()}
                <Tooltip
                  content={<DashboardChartTooltip />}
                  cursor={{ fill: "var(--dashboard-chart-hover)", stroke: "none" }}
                  offset={12}
                  allowEscapeViewBox={{ x: false, y: false }}
                  wrapperStyle={{ outline: "none", pointerEvents: "none" }}
                  isAnimationActive={!reduceMotion}
                  animationDuration={180}
                  animationEasing="ease-out"
                />
                <Legend verticalAlign="top" align="right" iconType="square" wrapperStyle={{ fontSize: 12, paddingBottom: 14 }} />
                <Bar
                  dataKey="entries"
                  name="Entries"
                  fill={`url(#${gradientId}-entries)`}
                  legendType="square"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={30}
                  activeBar={{ stroke: "var(--enterprise-chart-entry)", strokeWidth: 1, fillOpacity: 0.88 }}
                  isAnimationActive={!reduceMotion}
                  animationBegin={0}
                  animationDuration={320}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="exits"
                  name="Exits"
                  fill={`url(#${gradientId}-exits)`}
                  legendType="square"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={30}
                  activeBar={{ stroke: "var(--design-green)", strokeWidth: 1, strokeOpacity: 0.45 }}
                  isAnimationActive={!reduceMotion}
                  animationBegin={0}
                  animationDuration={320}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          empty
        )}
      </section>
      <section className="design-card overview-chart">
        <header>
          <h3>Occupancy Trend</h3>
          <p>Highest observed occupancy by {byHour ? "hour" : "day"}</p>
          {observedZero && <p role="status">Available observations recorded no visitor activity. Gaps remain unavailable.</p>}
        </header>
        {hasOccupancy ? (
          <div className="overview-chart-canvas">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={occupancyData} accessibilityLayer role="img" aria-label={`${filter} establishment peak occupancy history`} margin={{ top: 34, right: 20, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={`${gradientId}-occupancy`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--design-green)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--design-green)" stopOpacity={0.025} />
                  </linearGradient>
                </defs>
                {axes({ left: 12, right: 12 })}
                <Tooltip
                  content={<DashboardChartTooltip />}
                  cursor={{ stroke: "var(--design-green)", strokeOpacity: 0.3, strokeDasharray: "3 3" }}
                  offset={12}
                  allowEscapeViewBox={{ x: false, y: false }}
                  wrapperStyle={{ outline: "none", pointerEvents: "none" }}
                  isAnimationActive={!reduceMotion}
                  animationDuration={180}
                  animationEasing="ease-out"
                />
                <Area
                  type="linear"
                  dataKey="occupancy"
                  name="Peak occupancy"
                  stroke="var(--design-green)"
                  fill={`url(#${gradientId}-occupancy)`}
                  fillOpacity={1}
                  strokeWidth={2.25}
                  dot={{ r: 3, fill: "var(--enterprise-card-bg)", strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: "var(--design-green)", stroke: "var(--enterprise-card-bg)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={!reduceMotion}
                  animationBegin={0}
                  animationDuration={320}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          empty
        )}
      </section>
    </div>
  );
}
