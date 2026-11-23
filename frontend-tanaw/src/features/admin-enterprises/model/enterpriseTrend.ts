import type { IntakeReport, VisitorInsights } from "@/shared/types";

/*
 * The Enterprise Details trend chart. Each period reads the closest real figure the API has:
 *
 *   Hourly   /operational/visitor-insights?range=today: the most visitors inside at once in each hour
 *            (peakVisitors). Only hours with camera updates appear.
 *   Daily    /operational/visitor-insights?range=30d: the estimated unique visitors of each of the
 *            last 30 days (estimatedUniqueCount). A day without updates shows an empty slot, never 0.
 *   Monthly  submitted monthly reports (/operational/reports/intake): the unique visitors each report
 *            states. Months without a report are left out.
 */

export type TrendPeriod = "hourly" | "daily" | "monthly";

export type TrendBar = {
  key: string;
  /** Text under the bar ("6 PM", "Nov 14", "Oct"); empty when the axis skips it. */
  axisLabel: string;
  /** Full name for the tooltip and the accessible table ("Saturday, Nov 14"). */
  fullLabel: string;
  value: number | null;
};

export type Trend = {
  period: TrendPeriod;
  title: string;
  /** What one bar measures, for the note and tooltips ("visitors inside at peak"). */
  unit: string;
  bars: TrendBar[];
  busiest: TrendBar | null;
  /** Show the value above every bar (hourly, monthly) or only above the busiest one (daily). */
  labelEveryBar: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

/** "212K" for large monthly totals, the full number otherwise. */
export function formatCompact(value: number) {
  if (value < 10_000) return formatCount(value);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: value < 100_000 ? 1 : 0 }).format(value);
}

/** The calendar day of a backend timestamp, read from its own ISO text so the browser's time zone cannot shift it. */
export function calendarDayOf(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDay(date: Date) {
  return `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
}

export function busiestBar(bars: readonly TrendBar[]) {
  let best: TrendBar | null = null;
  for (const bar of bars) if (bar.value !== null && bar.value > 0 && (best === null || bar.value > (best.value ?? 0))) best = bar;
  return best;
}

export function hourlyTrend(insights: VisitorInsights | undefined): Trend {
  const bars = (insights?.series ?? []).map((point) => ({
    key: point.startAt,
    axisLabel: point.label,
    fullLabel: point.label,
    value: point.peakVisitors,
  }));
  return { period: "hourly", title: "Today’s Trend", unit: "visitors inside at peak", bars, busiest: busiestBar(bars), labelEveryBar: true };
}

export function dailyTrend(insights: VisitorInsights | undefined, today: Date, days = 30): Trend {
  const byDay = new Map<string, number | null>();
  for (const point of insights?.series ?? []) {
    const day = calendarDayOf(point.startAt);
    if (day) byDay.set(dayKey(day), point.estimatedUniqueCount ?? null);
  }
  const bars: TrendBar[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const index = days - 1 - offset;
    bars.push({
      key: dayKey(date),
      axisLabel: index % 7 === 0 ? shortDay(date) : "",
      fullLabel: `${WEEKDAYS[date.getDay()]}, ${shortDay(date)}`,
      value: byDay.get(dayKey(date)) ?? null,
    });
  }
  return { period: "daily", title: "Last 30 Days", unit: "visitors", bars, busiest: busiestBar(bars), labelEveryBar: false };
}

function periodOf(report: Pick<IntakeReport, "period" | "month">) {
  const [monthName = report.month, yearText] = report.period.trim().split(/\s+/);
  const month = MONTHS.findIndex((name) => name.toLowerCase() === monthName.toLowerCase());
  const year = Number(yearText);
  return month >= 0 && Number.isInteger(year) ? { month, year } : null;
}

export function monthlyTrend(reports: readonly IntakeReport[], enterpriseId: string, limit = 12): Trend {
  const totals = new Map<number, { month: number; year: number; value: number }>();
  for (const report of reports) {
    if (report.enterpriseId !== enterpriseId) continue;
    const period = periodOf(report);
    const value = report.metrics.unique;
    if (!period || typeof value !== "number") continue;
    const key = period.year * 12 + period.month;
    // One report per enterprise and month; keep the larger figure if a duplicate ever appears.
    totals.set(key, { ...period, value: Math.max(value, totals.get(key)?.value ?? 0) });
  }
  const bars = [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-limit)
    .map(([key, item]) => ({ key: String(key), axisLabel: MONTHS[item.month].slice(0, 3), fullLabel: `${MONTHS[item.month]} ${item.year}`, value: item.value }));
  return { period: "monthly", title: "Monthly Trend", unit: "visitors", bars, busiest: busiestBar(bars), labelEveryBar: true };
}

/** "Busiest: 6 PM · 96 visitors inside at peak" */
export function trendNote(trend: Trend) {
  if (!trend.busiest || trend.busiest.value === null) return null;
  return `Busiest: ${trend.busiest.fullLabel} · ${formatCount(trend.busiest.value)} ${trend.unit}`;
}

/** The busiest weekday of the daily trend, for the figure strip ("Saturday", "Nov 14 · 1,240 visitors"). */
export function busiestDay(trend: Trend) {
  const bar = trend.busiest;
  if (!bar || bar.value === null) return null;
  const [weekday, date] = bar.fullLabel.split(", ");
  return { weekday, note: `${date} · ${formatCount(bar.value)} ${trend.unit}` };
}

/** The bar's height as a share of the tallest bar, 0–100. */
export function barHeight(value: number | null, bars: readonly TrendBar[]) {
  const max = Math.max(0, ...bars.map((bar) => bar.value ?? 0));
  if (value === null || value <= 0 || max === 0) return 0;
  return Math.max(1.5, (value / max) * 100);
}
