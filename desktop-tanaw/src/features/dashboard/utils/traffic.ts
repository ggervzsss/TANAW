import type { SystemTimeFormat } from "../../../utils/date-time";
import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { DashboardRange, TrafficPoint, UsualValue } from "../types/dashboard";
import { addDays, rangeDates, shortDate, weekday, weekdayName } from "./dashboard-range";
import { formatHourLabel } from "./establishment";

/** Visitor Traffic groups a day into two-hour periods. */
export const BUCKET_HOURS = 2;
/** Below this many usual entries a percentage says more about chance than about the day. */
export const MIN_COMPARABLE_ENTRIES = 20;
/** Earlier weeks that set what a period usually looks like. */
export const USUAL_WEEKS = 4;
const MIN_USUAL_SAMPLES = 2;

function usualOf(values: number[]): UsualValue | null {
  if (values.length < MIN_USUAL_SAMPLES) return null;
  const typical = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { typical, low: Math.min(...values), high: Math.max(...values), samples: values.length };
}

function observedHour(hour: EstablishmentHourly["hours"][number]) {
  return hour.covered_ms > 0 || hour.entries > 0;
}

/** Visiting hours the chart always shows, so a quiet morning still sits in a full day. */
export const DAY_WINDOW = { from: 8, to: 20 };

/**
 * First hour of each two-hour period on the chart: the usual visiting hours, widened to include
 * every hour that has counts. `throughHour` (today's current hour) keeps today's periods on the
 * chart even before anything is counted, so a quiet day reads as zero instead of as no data.
 */
export function bucketStarts(hourly: EstablishmentHourly | null, throughHour: number | null = null) {
  const observed = (hourly?.hours ?? []).filter(observedHour).map((hour) => hour.hour);
  if (!hourly || hourly.state === "unavailable" || (!observed.length && throughHour === null)) return [];
  const first = Math.floor(Math.min(DAY_WINDOW.from, ...observed, throughHour ?? DAY_WINDOW.from) / BUCKET_HOURS) * BUCKET_HOURS;
  const last = Math.max(DAY_WINDOW.to - 1, ...observed, throughHour ?? 0);
  const starts = [];
  for (let hour = first; hour <= last; hour += BUCKET_HOURS) starts.push(hour);
  return starts;
}

/** The most visitors inside at once in a two-hour period, or null when no camera covered it. */
function bucketOccupancy(hourly: EstablishmentHourly | null, start: number) {
  const hours = (hourly?.hours ?? []).filter((hour) => hour.hour >= start && hour.hour < start + BUCKET_HOURS && observedHour(hour));
  return hours.length ? Math.max(0, ...hours.map((hour) => hour.peak_occupancy ?? 0)) : null;
}

/** Entries in a two-hour period, or null when no camera covered it. */
function bucketEntries(hourly: EstablishmentHourly | null, start: number) {
  const hours = (hourly?.hours ?? []).filter((hour) => hour.hour >= start && hour.hour < start + BUCKET_HOURS && observedHour(hour));
  return hours.length ? hours.reduce((sum, hour) => sum + hour.entries, 0) : null;
}

/**
 * Two-hour periods of one day. `history` holds the same weekday in earlier weeks; a period's usual
 * range needs at least two of them with counts.
 */
export function hourlyTraffic(hourly: EstablishmentHourly | null, history: Array<EstablishmentHourly | null>, timeFormat: SystemTimeFormat, throughHour: number | null = null): TrafficPoint[] {
  return bucketStarts(hourly, throughHour).map((start) => {
    const label = formatHourLabel(start, timeFormat);
    const end = formatHourLabel((start + BUCKET_HOURS) % 24, timeFormat);
    const samples = history.map((day) => bucketEntries(day, start)).filter((value): value is number => value !== null);
    return { key: `h${start}`, label, period: `${label} to ${end}`, entries: bucketEntries(hourly, start), occupancy: bucketOccupancy(hourly, start), usual: usualOf(samples) };
  });
}

function observedDay(day: DailyEstablishmentMetrics | undefined): day is DailyEstablishmentMetrics {
  return Boolean(day && day.movement_state !== "unavailable" && (day.covered_ms > 0 || day.qualified_observations > 0));
}

/** Entries per day of a range. `baseline` holds the weeks before it; each day is compared with its weekday. */
export function dailyTraffic(summary: EstablishmentSummary | null, baseline: EstablishmentSummary | null, range: Pick<DashboardRange, "from" | "to">, compactLabels: boolean): TrafficPoint[] {
  const byDate = new Map(summary?.days.map((day) => [day.business_date, day]) ?? []);
  const history = (baseline?.days ?? []).filter(observedDay);
  return rangeDates(range).map((date) => {
    const day = byDate.get(date);
    const samples = history.filter((item) => weekday(item.business_date) === weekday(date)).slice(-USUAL_WEEKS).map((item) => item.entries);
    return {
      key: date,
      label: compactLabels ? shortDate(date) : `${weekdayName(date).slice(0, 3)} ${Number(date.slice(8, 10))}`,
      period: `${weekdayName(date)}, ${shortDate(date)}`,
      entries: observedDay(day) ? (day.entries ?? 0) : null,
      occupancy: observedDay(day) ? (day.peak_occupancy ?? 0) : null,
      usual: usualOf(samples),
    };
  });
}

/** The same weekday in each of the earlier weeks, newest first. */
export function usualHistoryDates(date: string, weeks = USUAL_WEEKS) {
  return Array.from({ length: weeks }, (_, index) => addDays(date, -7 * (index + 1)));
}

/** Index of the period with the most entries, or -1 when nothing was counted. */
export function busiestIndex(points: TrafficPoint[]) {
  let best = -1;
  points.forEach((point, index) => {
    if (point.entries !== null && point.entries > 0 && (best < 0 || point.entries > (points[best].entries ?? 0))) best = index;
  });
  return best;
}

/**
 * Percent difference between a day and its usual, counting only what has happened so far.
 * `elapsedHours` (hours since midnight, fractional) limits today to the time already past.
 */
export function dayChangeFromUsual(points: TrafficPoint[], elapsedHours: number | null): number | null {
  let actual = 0;
  let usual = 0;
  for (const point of points) {
    if (point.entries === null || !point.usual) continue;
    const start = Number(point.key.slice(1));
    const share = elapsedHours === null ? 1 : Math.max(0, Math.min(1, (elapsedHours - start) / BUCKET_HOURS));
    if (share <= 0) continue;
    actual += point.entries;
    usual += point.usual.typical * share;
  }
  return usual >= MIN_COMPARABLE_ENTRIES ? Math.round(((actual - usual) / usual) * 100) : null;
}

/** Percent difference between a range's average day and the same number of days before it; today is left out of both. */
export function rangeChangeFromBefore(summary: EstablishmentSummary | null, baseline: EstablishmentSummary | null, range: Pick<DashboardRange, "from" | "to">, today: string): number | null {
  const length = rangeDates(range).length;
  const average = (days: DailyEstablishmentMetrics[]) => (days.length ? days.reduce((sum, day) => sum + day.entries, 0) / days.length : null);
  const current = average((summary?.days ?? []).filter((day) => observedDay(day) && day.business_date !== today && day.business_date >= range.from && day.business_date <= range.to));
  const before = average((baseline?.days ?? []).filter((day) => observedDay(day) && day.business_date >= addDays(range.from, -length) && day.business_date < range.from));
  return current !== null && before !== null && before >= MIN_COMPARABLE_ENTRIES ? Math.round(((current - before) / before) * 100) : null;
}

/** "15% more than a usual Monday", "About the same as the 7 days before" or null. */
export function describeChange(percent: number | null, against: string) {
  if (percent === null) return null;
  if (Math.abs(percent) < 2) return `About the same as ${against}`;
  return `${Math.abs(percent)}% ${percent > 0 ? "more" : "fewer"} than ${against}`;
}

/** Axis top and tick values: a round number a little above the largest value, in about four steps. */
export function niceScale(max: number) {
  if (!Number.isFinite(max) || max <= 0) return { top: 10, ticks: [0, 5, 10] };
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  // 2.5 steps only where they stay whole numbers (25, 250, …); small counts step by 1, 2 or 5.
  const factors = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, factors.map((factor) => factor * magnitude).find((value) => value >= raw) ?? 10 * magnitude);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 1000) / 1000);
  return { top, ticks };
}

/** A smooth path through the points that never overshoots between them (monotone cubic). */
export function monotonePath(points: Array<[number, number]>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = (points[i + 1][1] - points[i][1]) / (dx[i] || 1);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  const f = (value: number) => Math.round(value * 10) / 10;
  let path = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    path += `C${f(x0 + dx[i] / 3)},${f(y0 + (tangent[i] * dx[i]) / 3)} ${f(x1 - dx[i] / 3)},${f(y1 - (tangent[i + 1] * dx[i]) / 3)} ${f(x1)},${f(y1)}`;
  }
  return path;
}


/** Headroom above the tallest bar for the value bubble and the Busiest tag. */
export const PLOT_TOP = 30;

/** Consecutive indexes that pass a test; lines, bands and areas break between runs. */
export function runsWhere(points: TrafficPoint[], test: (point: TrafficPoint) => boolean) {
  const runs: number[][] = [];
  let run: number[] = [];
  points.forEach((point, index) => {
    if (test(point)) run.push(index);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** A round step (1, 2, 2.5 or 5 times a power of ten) of at least `raw`, never below 1. */
function niceStep(raw: number) {
  if (!Number.isFinite(raw) || raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factors = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  return factors.map((factor) => factor * magnitude).find((value) => value >= raw) ?? 10 * magnitude;
}

/**
 * Bars shade from light to deep Civic Green by entries, spread from the quietest period shown to the
 * busiest, so the busiest is always the deepest and the quietest the lightest. No entries, no shade.
 */
export const SHADE_LEVELS = 5;
export function shadeLevel(entries: number, fewest: number, most: number) {
  if (entries <= 0 || most <= 0) return 0;
  if (most <= fewest) return SHADE_LEVELS;
  const share = (entries - fewest) / (most - fewest);
  return Math.max(1, Math.min(SHADE_LEVELS, 1 + Math.floor(share * SHADE_LEVELS)));
}

/**
 * Where everything in Visitor Traffic is drawn: entries as bars on the right-hand scale, the usual
 * range of entries as a soft band, and occupancy (visitors inside) as a line with dots on its own
 * left-hand scale. Visitors inside at once are always far fewer than a day's entries, so on one
 * scale the line would lie flat on the floor; the two scales share the same gridlines. Today the
 * line ends at the live reading; other days it traces each period's peak. `single` is a day of
 * two-hour periods; otherwise each point is a day. `leftGutter` makes room for the occupancy scale.
 */
export function trafficGeometry(points: TrafficPoint[], width: number, plotHeight: number, gutter: number, single: boolean, leftGutter = 0) {
  const plotWidth = Math.max(0, width - gutter - leftGutter);
  const n = points.length || 1;
  const slot = plotWidth / n;
  const left = leftGutter;
  const x = (i: number) => left + slot * i + slot / 2;
  // Redesign 3: a day's periods get bars half their slot wide, up to 60px; days get 32px at most.
  const barWidth = Math.max(3, Math.min(single ? 60 : 32, slot * (single ? 0.52 : 0.56)));
  const radius = Math.min(barWidth / 2, 10);

  const barsH = Math.max(1, plotHeight);
  const base = PLOT_TOP + barsH;

  const largest = Math.max(4, ...points.map((point) => Math.max(point.entries ?? 0, point.usual ? point.usual.high : 0)));
  const scale = niceScale(largest);
  // A short bars panel keeps every other gridline, and the top one.
  const ticks = barsH < 110 && scale.ticks.length > 4 ? scale.ticks.filter((_, k) => k % 2 === 0 || k === scale.ticks.length - 1) : scale.ticks;
  const y = (value: number) => base - (Math.min(Math.max(value, 0), scale.top) / scale.top) * barsH;

  // Occupancy's own scale: as many round steps as the entries scale, so its labels sit on the same gridlines.
  const steps = Math.max(1, scale.ticks.length - 1);
  const mostInside = Math.max(0, ...points.map((point) => (point.later ? 0 : (point.occupancy ?? 0))));
  // An empty day still gets a readable scale (0 to about 10), with the line on the floor.
  const occupancyTop = niceStep(Math.max(mostInside, 10) / steps) * steps;
  const yOccupancy = (value: number) => base - (Math.min(Math.max(value, 0), occupancyTop) / occupancyTop) * barsH;
  /** The occupancy value that sits on an entries gridline. */
  const occupancyAt = (tick: number) => Math.round((tick / scale.top) * occupancyTop);

  const counted = points.map((point) => point.entries ?? 0).filter((value) => value > 0);
  const mostEntries = Math.max(0, ...counted);
  const fewestEntries = counted.length ? Math.min(...counted) : 0;
  const shade = (entries: number) => shadeLevel(entries, fewestEntries, mostEntries);

  // The usual entries: a soft band from low to high, broken where a period has no usual. Periods of
  // today that have not happened show nothing, so the chart never looks like it holds data it doesn't.
  const allUsualRuns = runsWhere(points, (point) => point.usual !== null && !point.later);
  // A period whose neighbours have no usual still shows its range, as a short capsule around its bar.
  const capsule = Math.min(slot * 0.8, barWidth + 12);
  const band = allUsualRuns
    .map((run) => {
      if (run.length === 1) {
        const i = run[0];
        const top = y(points[i].usual!.high);
        const bottom = Math.max(top + 2, y(points[i].usual!.low));
        return `M${x(i) - capsule / 2},${top}h${capsule}V${bottom}h${-capsule}Z`;
      }
      const upper = monotonePath(run.map((i) => [x(i), y(points[i].usual!.high)]));
      const lower = monotonePath([...run].reverse().map((i) => [x(i), y(points[i].usual!.low)]));
      return `${upper}L${lower.slice(1)}Z`;
    })
    .join("");
  // Occupancy: one line through every period that has happened and has a reading, broken at gaps.
  const occupancyLine = runsWhere(points, (point) => !point.later && point.occupancy !== null)
    .filter((run) => run.length > 1)
    .map((run) => monotonePath(run.map((i) => [x(i), yOccupancy(points[i].occupancy!)])))
    .join("");

  return { left, plotWidth, plotHeight, slot, dense: n > 12, barWidth, radius, x, y, yOccupancy, occupancyAt, occupancyTop, shade, top: scale.top, ticks, base, barsH, band, occupancyLine };
}
