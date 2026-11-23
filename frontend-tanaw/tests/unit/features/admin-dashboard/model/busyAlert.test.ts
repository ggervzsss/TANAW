import { describe, expect, it } from "vitest";
import { busyCountsText, busyEnterprises, busyNames, busySignature, busyTitle } from "@/features/admin-dashboard/model/busyAlert";
import type { VisitorInsightEnterprise } from "@/shared/types";

function insight(id: string, percent: number | null, overrides: Partial<VisitorInsightEnterprise> = {}): VisitorInsightEnterprise {
  return {
    enterpriseId: id,
    enterpriseName: `Place ${id}`,
    barangay: "Landayan",
    currentVisitors: 60,
    typicalVisitors: 43,
    differencePercent: percent,
    activityLevel: "Busier Than Usual",
    ...overrides,
  };
}

describe("busy alert", () => {
  it("keeps only busier-than-usual enterprises, highest percent first, and marks pinned ones", () => {
    const items = busyEnterprises([insight("a", 28), insight("b", 41), insight("c", 10, { activityLevel: "Usual" }), insight("d", null)], new Set(["b"]));
    expect(items.map(({ enterpriseId }) => enterpriseId)).toEqual(["b", "a", "d"]);
    expect(items.map(({ pinned }) => pinned)).toEqual([true, false, false]);
  });

  it("changes its signature only when the set or a 20-point step changes", () => {
    const base = busyEnterprises([insight("a", 41), insight("b", 28)], new Set());
    expect(busySignature(busyEnterprises([insight("b", 30), insight("a", 45)], new Set()))).toBe(busySignature(base));
    expect(busySignature(busyEnterprises([insight("a", 61), insight("b", 28)], new Set()))).not.toBe(busySignature(base));
    expect(busySignature(busyEnterprises([insight("a", 41)], new Set()))).not.toBe(busySignature(base));
  });

  it("titles one, several or most enterprises", () => {
    expect(busyTitle(1, 12)).toBe("More visitors than usual");
    expect(busyTitle(6, 12)).toBe("More visitors than usual at 6 enterprises");
    expect(busyTitle(7, 12)).toBe("Busier than usual across San Pedro");
  });

  it("lists names and counts", () => {
    const items = busyEnterprises([insight("a", 41), insight("b", 40), insight("c", 30), insight("d", 29)], new Set());
    expect(busyNames(items)).toBe("Place a, Place b and 2 more");
    expect(busyNames(items.slice(0, 2))).toBe("Place a and Place b");
    expect(busyCountsText(items[0])).toBe("60 inside, usual for this hour is 43");
    expect(busyCountsText(items[0], true)).toBe("60 inside, usual 43");
  });
});
