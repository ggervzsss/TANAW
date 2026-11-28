import { describe, expect, it } from "vitest";
import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentSummary } from "../../../../../src/features/camera/services/establishment.types";
import type { TrafficPoint } from "../../../../../src/features/dashboard/types/dashboard";
import {
  bucketStarts,
  busiestIndex,
  dailyTraffic,
  dayChangeFromUsual,
  describeChange,
  hourlyTraffic,
  monotonePath,
  niceScale,
  PLOT_TOP,
  shadeLevel,
  trafficGeometry,
  rangeChangeFromBefore,
  todaySoFar,
  usualHistoryDates,
} from "../../../../../src/features/dashboard/utils/traffic";

const HOUR_MS = 3_600_000;

function hourly(entries: Record<number, number>, state: EstablishmentHourly["state"] = "available") {
  return {
    state,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, entries: entries[hour] ?? 0, area_visits: 0, peak_occupancy: null, covered_ms: hour in entries ? HOUR_MS : 0 })),
  } as EstablishmentHourly;
}

function day(business_date: string, entries: number, covered = true) {
  return { business_date, entries, covered_ms: covered ? HOUR_MS : 0, qualified_observations: covered ? 1 : 0, movement_state: "available" } as DailyEstablishmentMetrics;
}

describe("two-hour periods of a day", () => {
  it("runs from the first counted period to the last, in two-hour steps, with no empty hours at either end", () => {
    expect(bucketStarts(hourly({ 9: 4, 14: 2 }))).toEqual([8, 10, 12, 14]);
    expect(bucketStarts(hourly({ 6: 1, 21: 3 }))).toEqual([6, 8, 10, 12, 14, 16, 18, 20]);
    expect(bucketStarts(hourly({ 11: 1, 16: 3 }))).toEqual([10, 12, 14, 16]);
    expect(bucketStarts(hourly({}))).toEqual([]);
    expect(bucketStarts(hourly({ 9: 4 }, "unavailable"))).toEqual([]);
    expect(bucketStarts(null)).toEqual([]);
  });

  it("ends today at the period under way, and keeps it on the chart before anything is counted", () => {
    expect(bucketStarts(hourly({ 8: 3, 9: 1 }), 13)).toEqual([8, 10, 12]);
    expect(bucketStarts(hourly({ 10: 3 }), 15)).toEqual([10, 12, 14]);
    expect(bucketStarts(hourly({}), 10)).toEqual([10]);
    expect(bucketStarts(hourly({}), 21)).toEqual([20]);
    expect(bucketStarts(hourly({}), 2)).toEqual([2]);
    expect(bucketStarts(hourly({}, "unavailable"), 10)).toEqual([]);
    expect(hourlyTraffic(hourly({}), [], "12-hour", 10).map((point) => point.entries)).toEqual([null]);
  });

  it("draws today only up to now: uncounted periods read as zero and the period under way carries the live reading", () => {
    const points = todaySoFar(hourlyTraffic(hourly({ 8: 40, 13: 5 }), [], "12-hour", 13), 13.5, 17);
    expect(points.map((point) => [point.key, point.entries, point.occupancy])).toEqual([
      ["h8", 40, 0],
      ["h10", 0, 0],
      ["h12", 5, 17],
    ]);
    // A period that has not started never reaches the chart.
    const ahead = [...hourlyTraffic(hourly({ 8: 40 }), [], "12-hour"), { key: "h16", label: "4 PM", period: "4 PM to 6 PM", entries: null, occupancy: null, usual: null }];
    expect(todaySoFar(ahead, 9, null).map((point) => point.key)).toEqual(["h8"]);
  });

  it("adds entries per period, keeps uncovered periods as gaps and names them", () => {
    const points = hourlyTraffic(hourly({ 8: 100, 9: 160, 12: 40, 17: 2 }), [], "12-hour");
    expect(points.map((point) => [point.label, point.entries])).toEqual([
      ["8 AM", 260],
      ["10 AM", null],
      ["12 PM", 40],
      ["2 PM", null],
      ["4 PM", 2],
    ]);
    expect(points[0].period).toBe("8 AM to 10 AM");
    expect(points[0].usual).toBeNull();
  });

  it("sets the usual range from at least two earlier weeks", () => {
    const history = [hourly({ 8: 120, 9: 180 }), hourly({ 8: 100, 9: 100 }), null, hourly({ 10: 5 })];
    const [first] = hourlyTraffic(hourly({ 8: 100, 9: 160 }), history, "12-hour");
    expect(first.usual).toEqual({ typical: 250, low: 200, high: 300, samples: 2 });
    const onlyOne = hourlyTraffic(hourly({ 8: 1 }), [hourly({ 8: 3 })], "12-hour");
    expect(onlyOne[0].usual).toBeNull();
  });

  it("compares a day with its usual, and only the hours already past for today", () => {
    const history = [hourly({ 8: 100, 10: 100 }), hourly({ 8: 100, 10: 100 })];
    const points = hourlyTraffic(hourly({ 8: 150, 10: 50 }), history, "12-hour");
    expect(dayChangeFromUsual(points, null)).toBe(0);
    // At 9 AM only half of the first period has happened: 150 entries against a usual 50.
    expect(dayChangeFromUsual(points, 9)).toBe(200);
    expect(dayChangeFromUsual(hourlyTraffic(hourly({ 8: 5 }), [], "12-hour"), null)).toBeNull();
  });

  it("looks back four weeks on the same weekday", () => {
    expect(usualHistoryDates("2026-11-16")).toEqual(["2026-11-09", "2026-11-02", "2026-10-26", "2026-10-19"]);
  });
});

describe("days of a range", () => {
  const range = { from: "2026-11-14", to: "2026-11-16" };
  const summary = { days: [day("2026-11-14", 500), day("2026-11-16", 300)] } as EstablishmentSummary;
  const baseline = { days: [day("2026-11-07", 400), day("2026-10-31", 600), day("2026-11-09", 200), day("2026-11-02", 220), day("2026-11-13", 350)] } as EstablishmentSummary;

  it("gives each day its entries and the usual range for its weekday", () => {
    const points = dailyTraffic(summary, baseline, range, false);
    expect(points.map((point) => point.label)).toEqual(["Sat 14", "Sun 15", "Mon 16"]);
    expect(points.map((point) => point.entries)).toEqual([500, null, 300]);
    expect(points[0].usual).toEqual({ typical: 500, low: 400, high: 600, samples: 2 });
    expect(points[2].usual).toMatchObject({ typical: 210 });
    expect(dailyTraffic(summary, baseline, range, true)[0].label).toBe("Nov 14");
  });

  it("compares the average complete day with the days before, leaving today out", () => {
    const week = { from: "2026-11-10", to: "2026-11-16" };
    const current = { days: [day("2026-11-10", 110), day("2026-11-11", 90), day("2026-11-16", 5)] } as EstablishmentSummary;
    const before = { days: [day("2026-11-03", 80), day("2026-11-04", 120), day("2026-10-01", 999)] } as EstablishmentSummary;
    expect(rangeChangeFromBefore(current, before, week, "2026-11-16")).toBe(0);
    expect(rangeChangeFromBefore(current, null, week, "2026-11-16")).toBeNull();
  });

  it("finds the busiest period and ignores empty ones", () => {
    expect(busiestIndex(dailyTraffic(summary, null, range, false))).toBe(0);
    expect(busiestIndex(dailyTraffic({ days: [] } as unknown as EstablishmentSummary, null, range, false))).toBe(-1);
  });
});

describe("wording and chart helpers", () => {
  it("describes a change in plain words", () => {
    expect(describeChange(15, "a usual Monday")).toBe("15% more than a usual Monday");
    expect(describeChange(-8, "the 7 days before")).toBe("8% fewer than the 7 days before");
    expect(describeChange(1, "a usual Monday")).toBe("About the same as a usual Monday");
    expect(describeChange(null, "a usual Monday")).toBeNull();
  });

  it("rounds the axis to about four even steps", () => {
    expect(niceScale(960)).toEqual({ top: 1000, ticks: [0, 250, 500, 750, 1000] });
    expect(niceScale(5657).top).toBe(6000);
    expect(niceScale(0)).toEqual({ top: 10, ticks: [0, 5, 10] });
  });

  it("draws a smooth path that passes through every point", () => {
    const path = monotonePath([
      [0, 10],
      [10, 0],
      [20, 5],
    ]);
    expect(path.startsWith("M0,10C")).toBe(true);
    expect(path.endsWith(" 20,5")).toBe(true);
    expect(monotonePath([[3, 4]])).toBe("M3,4");
    expect(monotonePath([])).toBe("");
  });
});

describe("comparisons need enough history", () => {
  it("gives no percentage when the usual count is too small to compare", () => {
    const history = [hourly({ 8: 1 }), hourly({ 8: 1 })];
    expect(dayChangeFromUsual(hourlyTraffic(hourly({ 8: 300 }), history, "12-hour"), null)).toBeNull();
    const week = { from: "2026-11-10", to: "2026-11-16" };
    const current = { days: [day("2026-11-10", 50)] } as EstablishmentSummary;
    const sparse = { days: [day("2026-11-03", 2)] } as EstablishmentSummary;
    expect(rangeChangeFromBefore(current, sparse, week, "2026-11-16")).toBeNull();
  });
});

describe("chart geometry", () => {
  const point = (i: number, entries: number | null, occupancy: number | null, usual = true) =>
    ({ key: `p${i}`, label: `P${i}`, period: `P${i}`, entries, occupancy, usual: usual ? { low: 300, typical: 400, high: 500 } : null }) as TrafficPoint;

  it("gives the bars the whole plot, with zero on the baseline and the scale's top at the headroom", () => {
    const g = trafficGeometry([point(0, 3000, 0), point(1, 4800, 212), point(2, 4100, 380)], 1370, 215, 70, false);
    expect(g.base).toBe(PLOT_TOP + 215);
    expect(g.barsH).toBe(215);
    expect(g.y(0)).toBe(g.base);
    expect(g.y(g.top)).toBe(PLOT_TOP);
    expect(g.top).toBeGreaterThanOrEqual(4800);
  });

  it("sizes bars like Redesign 3: half a day period's slot up to 60px, days up to 32px", () => {
    const day = trafficGeometry(Array.from({ length: 7 }, (_, i) => point(i, 500, 50)), 920, 215, 70, true);
    expect(day.barWidth).toBe(60);
    expect(day.radius).toBe(10);
    const month = trafficGeometry(Array.from({ length: 31 }, (_, i) => point(i, 4000, 300)), 970, 215, 70, false);
    expect(month.dense).toBe(true);
    expect(month.barWidth).toBeLessThanOrEqual(32);
    expect(month.barWidth).toBeCloseTo((900 / 31) * 0.56, 5);
    expect(month.y(-5)).toBe(month.base);
    expect(month.y(10 ** 9)).toBe(PLOT_TOP);
  });

  it("draws the usual band through every run of periods that has a usual, and breaks between runs", () => {
    const points = [point(0, 10, 1), point(1, 20, 2), point(2, 30, 3, false), point(3, 40, 4), point(4, 50, 5)];
    const g = trafficGeometry(points, 1000, 200, 70, true);
    expect(g.band.match(/M/g)).toHaveLength(2);
    expect(g.band.match(/Z/g)).toHaveLength(2);
    // A lone period with a usual still shows its range, as a capsule.
    const lone = trafficGeometry([point(0, 10, 1), point(1, 20, 2, false)], 1000, 200, 70, true);
    expect(lone.band.match(/Z/g)).toHaveLength(1);
    expect(lone.band).toContain(`V${lone.y(300)}`);
    expect(lone.band.startsWith(`M${lone.x(0) - Math.min(lone.slot * 0.8, lone.barWidth + 12) / 2},${lone.y(500)}`)).toBe(true);
  });

  it("draws occupancy as one line through the periods that have happened, broken at gaps", () => {
    const points = [point(0, 10, 4), point(1, 20, 0), point(2, 30, null), point(3, 40, 6), point(4, 50, 9), point(5, null, null)];
    const g = trafficGeometry(points, 1000, 200, 70, true);
    expect(g.occupancyLine.match(/M/g)).toHaveLength(2);
    const f = (value: number) => Math.round(value * 10) / 10;
    expect(g.occupancyLine.startsWith(`M${f(g.x(0))},${f(g.yOccupancy(4))}`)).toBe(true);
    // A zero reading sits on the baseline: the line stays down when nobody is inside.
    expect(g.occupancyLine).toContain(`${f(g.x(1))},${f(g.base)}`);
    expect(trafficGeometry([point(0, 10, 4), point(1, 20, null)], 1000, 200, 70, true).occupancyLine).toBe("");
  });

  it("gives occupancy its own scale on the same gridlines, so the line never lies flat on the floor", () => {
    const g = trafficGeometry([point(0, 5000, 600, false), point(1, 4000, 300, false)], 1000, 200, 70, false, 56);
    // Entries keep their own scale; visitors inside rise to the same height range.
    expect(g.top).toBeGreaterThanOrEqual(5000);
    expect(g.occupancyTop).toBeGreaterThanOrEqual(600);
    expect(g.occupancyTop).toBeLessThan(5000);
    expect(g.yOccupancy(600)).toBeLessThan(g.base - g.barsH / 2);
    // Every entries gridline carries a round occupancy value.
    expect(g.ticks.map((tick) => g.occupancyAt(tick))).toEqual(g.ticks.map((_, k) => (k * g.occupancyTop) / (g.ticks.length - 1)));
    // The left gutter shifts the plot, and the first slot starts after it.
    expect(g.left).toBe(56);
    expect(g.x(0)).toBe(56 + g.slot / 2);
  });

  it("keeps an empty day's occupancy scale readable", () => {
    const g = trafficGeometry([point(0, 0, 0, false), point(1, 0, 0, false)], 1000, 200, 70, true);
    expect(g.occupancyTop).toBeGreaterThanOrEqual(10);
    expect(g.yOccupancy(0)).toBe(g.base);
  });

  it("spreads the periods across the whole plot, edge to edge", () => {
    // Three periods so far today fill the plot as fully as a whole day's six would.
    for (const count of [3, 6]) {
      const g = trafficGeometry(
        Array.from({ length: count }, (_, i) => point(i, 100 + i, 10)),
        1000,
        200,
        70,
        true,
        56,
      );
      expect(g.x(0) - g.slot / 2).toBeCloseTo(g.left, 6);
      expect(g.x(count - 1) + g.slot / 2).toBeCloseTo(g.left + g.plotWidth, 6);
    }
  });

  it("keeps the usual within scale, so a high usual never clips above the plot", () => {
    const g = trafficGeometry([point(0, 100, null), point(1, 120, null)], 1000, 200, 70, true);
    expect(g.top).toBeGreaterThanOrEqual(500);
    expect(g.y(500)).toBeGreaterThanOrEqual(PLOT_TOP);
  });
});

describe("bar shades", () => {
  it("runs from the quietest period to the busiest, which is always the deepest", () => {
    expect(shadeLevel(5374, 3000, 5374)).toBe(5);
    expect(shadeLevel(3000, 3000, 5374)).toBe(1);
    expect(shadeLevel(4200, 3000, 5374)).toBe(3);
  });

  it("gives no shade to a period without entries, and the deepest when every period is alike", () => {
    expect(shadeLevel(0, 0, 0)).toBe(0);
    expect(shadeLevel(0, 10, 50)).toBe(0);
    expect(shadeLevel(40, 40, 40)).toBe(5);
  });
});
