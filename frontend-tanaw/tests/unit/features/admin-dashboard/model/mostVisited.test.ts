import { describe, expect, it } from "vitest";
import {
  cameraWindowFor,
  collectVisitorEntries,
  dailyUniqueCounts,
  formatCompactCount,
  monthKeyOfPeriod,
  mostVisitedSubtitle,
  planMostVisited,
  rankVisitors,
  reportedMonths,
} from "@/features/admin-dashboard/model/mostVisited";
import { intakeReport, mapEnterprise } from "./fixtures";

const today = new Date(2026, 10, 23);

describe("most visited sources", () => {
  it("reads report periods", () => {
    expect(monthKeyOfPeriod("November 2026")).toBe("2026-11");
    expect(monthKeyOfPeriod("Sometime")).toBeNull();
  });

  it("counts this month from camera counts, with today live", () => {
    const plan = planMostVisited({ start: "2026-11-01", end: "2026-11-23" }, today, new Set());
    expect(plan.reportMonths).toEqual([]);
    expect(plan.cameraDays).toHaveLength(22);
    expect(plan.includesToday).toBe(true);
    expect(cameraWindowFor(plan, today)).toBe("30d");
    expect(mostVisitedSubtitle("enterprises", 5, plan)).toBe("Top 5 enterprises by visitors, from camera counts.");
  });

  it("counts a whole reported past month from monthly reports", () => {
    const plan = planMostVisited({ start: "2026-09-01", end: "2026-09-30" }, today, new Set(["2026-09"]));
    expect(plan).toEqual({ reportMonths: ["2026-09"], cameraDays: [], includesToday: false, uncoveredDays: 0 });
    expect(mostVisitedSubtitle("barangays", 3, plan)).toBe("Top 3 barangays by visitors, from monthly reports.");
  });

  it("mixes reports and camera counts, and falls back to cameras for an unreported month", () => {
    const plan = planMostVisited({ start: "2026-10-01", end: "2026-11-23" }, today, new Set(["2026-10"]));
    expect(plan.reportMonths).toEqual(["2026-10"]);
    expect(plan.cameraDays[0]).toBe("2026-11-01");
    expect(mostVisitedSubtitle("categories", 1, plan)).toBe("Top category by visitors, from monthly reports and camera counts.");

    const unreported = planMostVisited({ start: "2026-10-01", end: "2026-10-31" }, today, new Set());
    expect(unreported.reportMonths).toEqual([]);
    expect(unreported.cameraDays[0]).toBe("2026-10-25");
    expect(unreported.uncoveredDays).toBe(24);
    expect(mostVisitedSubtitle("enterprises", 2, unreported)).toContain("are not counted");
  });

  it("uses the 7-day window for the last week", () => {
    const plan = planMostVisited({ start: "2026-11-17", end: "2026-11-23" }, today, new Set());
    expect(cameraWindowFor(plan, today)).toBe("7d");
    expect(cameraWindowFor(planMostVisited({ start: "2026-11-23", end: "2026-11-23" }, today, new Set()), today)).toBeNull();
  });
});

describe("most visited ranking", () => {
  const plaza = mapEnterprise({ id: "plaza", name: "City Plaza", barangay: "Poblacion", category: "Park", estimatedUniqueCount: 50 });
  const church = mapEnterprise({ id: "church", name: "Pilgrim Church", barangay: "Landayan", category: "Religious", estimatedUniqueCount: 20 });

  it("adds reports, camera days and today's live count per enterprise", () => {
    const plan = planMostVisited({ start: "2026-10-01", end: "2026-11-23" }, today, new Set(["2026-10"]));
    const reports = [
      intakeReport({ enterpriseId: "church", enterprise: "Pilgrim Church", period: "October 2026", metrics: { entry: null, exit: null, unique: 900, peak: null } }),
      intakeReport({ enterpriseId: "plaza", enterprise: "City Plaza", period: "August 2026" }),
    ];
    const daily = new Map([
      [
        "plaza",
        new Map([
          ["2026-11-02", 300],
          ["2026-10-20", 999],
        ]),
      ],
    ]);
    const entries = collectVisitorEntries(plan, reports, [plaza, church], daily);
    expect(rankVisitors(entries, "enterprises")).toEqual([
      { key: "church", label: "Pilgrim Church", visitors: 920, enterpriseId: "church" },
      { key: "plaza", label: "City Plaza", visitors: 350, enterpriseId: "plaza" },
    ]);
    expect(rankVisitors(entries, "barangays").map(({ label }) => label)).toEqual(["Landayan", "Poblacion"]);
  });

  it("keeps the top five with visitors", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({ enterpriseId: `e${index}`, name: `E${index}`, barangay: "Nueva", category: index % 2 ? "Park" : "Mall", visitors: index * 10 }));
    expect(rankVisitors(entries, "enterprises").map(({ visitors }) => visitors)).toEqual([60, 50, 40, 30, 20]);
    expect(rankVisitors(entries, "categories")).toEqual([
      { key: "mall", label: "Mall", visitors: 120 },
      { key: "park", label: "Park", visitors: 90 },
    ]);
  });

  it("reads daily unique counts in Philippine days, and reported months", () => {
    const days = dailyUniqueCounts([
      { startAt: "2026-11-02T00:00:00+08:00", label: "Mon, Nov 2", averageVisitors: 1, peakVisitors: 2, estimatedUniqueCount: 40 },
      { startAt: "2026-11-03T00:00:00+08:00", label: "Tue, Nov 3", averageVisitors: 1, peakVisitors: 2, estimatedUniqueCount: null },
    ]);
    expect([...days]).toEqual([["2026-11-02", 40]]);
    expect([...reportedMonths([{ period: "October 2026" }, { period: "bad" }])]).toEqual(["2026-10"]);
    expect(formatCompactCount(14_200)).toBe("14.2K");
    expect(formatCompactCount(980)).toBe("980");
  });
});
