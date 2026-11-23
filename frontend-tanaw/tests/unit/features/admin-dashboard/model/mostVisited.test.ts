import { describe, expect, it } from "vitest";
import { formatCompactCount, mostVisitedSource, mostVisitedSubtitle, rankVisitors, type VisitorEntry } from "@/features/admin-dashboard/model/mostVisited";

describe("most visited sources", () => {
  it("names the sources the server used", () => {
    expect(mostVisitedSource({ reportMonths: [], cameraDays: 23, uncoveredDays: 0 })).toBe("from camera counts");
    expect(mostVisitedSource({ reportMonths: ["2026-09"], cameraDays: 0, uncoveredDays: 0 })).toBe("from monthly reports");
    expect(mostVisitedSource({ reportMonths: ["2026-10"], cameraDays: 23, uncoveredDays: 0 })).toBe("from monthly reports and camera counts");
    expect(mostVisitedSource({ reportMonths: [], cameraDays: 0, uncoveredDays: 31 })).toBeNull();
  });

  it("words the subtitle for the scope, the count shown and any uncovered days", () => {
    expect(mostVisitedSubtitle("enterprises", 5, { reportMonths: [], cameraDays: 23, uncoveredDays: 0 })).toBe("Top 5 enterprises by visitors, from camera counts.");
    expect(mostVisitedSubtitle("barangays", 3, { reportMonths: ["2026-09"], cameraDays: 0, uncoveredDays: 0 })).toBe("Top 3 barangays by visitors, from monthly reports.");
    expect(mostVisitedSubtitle("categories", 1, { reportMonths: ["2026-10"], cameraDays: 23, uncoveredDays: 0 })).toBe("Top category by visitors, from monthly reports and camera counts.");
    expect(mostVisitedSubtitle("enterprises", 2, { reportMonths: [], cameraDays: 6, uncoveredDays: 25 })).toContain("are not counted");
    expect(mostVisitedSubtitle("enterprises", 5, { reportMonths: [], cameraDays: 0, uncoveredDays: 31 })).toBe("No monthly report or camera count covers this range.");
  });
});

describe("most visited ranking", () => {
  const entry = (enterpriseId: string, enterpriseName: string, barangay: string, category: string, visitors: number): VisitorEntry => ({ enterpriseId, enterpriseName, barangay, category, visitors });

  it("ranks enterprises and groups barangays from the server's per-enterprise totals", () => {
    const entries = [entry("plaza", "City Plaza", "Poblacion", "Park", 350), entry("church", "Pilgrim Church", "Landayan", "Religious", 920), entry("park", "Town Park", "Poblacion", "Park", 700)];
    expect(rankVisitors(entries, "enterprises")).toEqual([
      { key: "church", label: "Pilgrim Church", visitors: 920, enterpriseId: "church" },
      { key: "park", label: "Town Park", visitors: 700, enterpriseId: "park" },
      { key: "plaza", label: "City Plaza", visitors: 350, enterpriseId: "plaza" },
    ]);
    expect(rankVisitors(entries, "barangays")).toEqual([
      { key: "poblacion", label: "Poblacion", visitors: 1050, barangay: "Poblacion" },
      { key: "landayan", label: "Landayan", visitors: 920, barangay: "Landayan" },
    ]);
  });

  it("keeps the top five with visitors", () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry(`e${index}`, `E${index}`, "Nueva", index % 2 ? "Park" : "Mall", index * 10));
    expect(rankVisitors(entries, "enterprises").map(({ visitors }) => visitors)).toEqual([60, 50, 40, 30, 20]);
    expect(rankVisitors(entries, "categories")).toEqual([
      { key: "mall", label: "Mall", visitors: 120 },
      { key: "park", label: "Park", visitors: 90 },
    ]);
  });

  it("formats compact counts", () => {
    expect(formatCompactCount(14_200)).toBe("14.2K");
    expect(formatCompactCount(980)).toBe("980");
  });
});
