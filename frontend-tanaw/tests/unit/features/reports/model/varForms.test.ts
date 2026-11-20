import { describe, expect, it } from "vitest";
import type { FinalReport, FinalReportSource } from "@/shared/types";
import { filterGeneratedReports } from "../../../../../src/features/reports/model/generatedReports";
import { buildVar2m, buildVar3, sumCells, var2mCells, var3Cells, var3Years } from "../../../../../src/features/reports/model/varForms";

const allocated = {
  thisProvMale: 30,
  thisProvFemale: 34,
  thisProvUnspecified: 6,
  otherProvMale: 10,
  otherProvFemale: 8,
  foreignMale: 7,
  foreignFemale: 5,
  thisCityMale: 20,
  thisCityFemale: 25,
  thisCityUnspecified: 4,
};

function finalReport(id: string, period: string, status: FinalReport["status"], sources: Partial<FinalReportSource>[]): FinalReport {
  const full = sources.map((source, index) => ({ id: `${id}-${index}`, enterpriseProfileId: source.enterprise ?? "unnamed", attractionCode: "411", enterprise: "Unnamed", code: `REP-${index}`, unique: 0, entry: null, exit: null, ...source }));
  return {
    id,
    title: "Citywide Tourism Aggregation",
    period,
    generatedOn: "2026-06-01",
    preparedBy: "LGU Staff",
    preparedRole: "Staff Processing Division",
    status,
    totalEntry: null,
    totalExit: null,
    totalUnique: full.reduce((sum, source) => sum + source.unique, 0),
    enterpriseCount: full.length,
    sources: full,
  };
}

describe("VAR 2M", () => {
  it("splits This Municipality out of This Province, sex by sex", () => {
    expect(var2mCells(100, allocated)).toEqual([20, 25, 49, 10, 9, 21, 10, 8, 18, 7, 5, 12, 47, 47, 100]);
  });

  it("keeps This Province whole when no municipality split was recorded", () => {
    const { thisCityMale, thisCityFemale, thisCityUnspecified, ...province } = allocated;
    expect([thisCityMale, thisCityFemale, thisCityUnspecified]).toHaveLength(3);
    expect(var2mCells(100, province).slice(0, 6)).toEqual([null, null, null, 30, 34, 70]);
  });

  it("shows only the grand total when residence was not recorded or does not add up", () => {
    const blank = [...Array(14).fill(null), 100];
    expect(var2mCells(100, null)).toEqual(blank);
    expect(var2mCells(101, allocated)).toEqual([...Array(14).fill(null), 101]);
    expect(var2mCells(100, { ...allocated, thisCityMale: 31 }).slice(0, 3)).toEqual([null, null, null]);
  });

  it("totals the month like the template's SUM, and explains blank cells", () => {
    const form = buildVar2m("May 2026", [
      { id: "a", name: "Plaza", attractionCode: "411", unique: 100, demographics: allocated },
      { id: "b", name: "Museum", attractionCode: "205", unique: 40, demographics: undefined },
    ]);
    expect(form.totals[0]).toBe(20);
    expect(form.totals[14]).toBe(140);
    expect(form.rows.map((row) => row.code)).toEqual(["411", "205"]);
    expect(form.notes).toEqual(["Sex and residence were not recorded for Museum; only the grand total is shown."]);
    expect(sumCells([null, null])).toBeNull();
  });
});

describe("VAR 3M", () => {
  it("uses the establishment identity and saved code to keep same-name or reclassified sites distinct", () => {
    const reports = [
      finalReport("may", "May 2026", "Finalized", [
        { enterpriseProfileId: "one", enterprise: "Riverside", attractionCode: "411", unique: 10 },
        { enterpriseProfileId: "two", enterprise: "Riverside", attractionCode: "411", unique: 20 },
      ]),
      finalReport("june", "June 2026", "Finalized", [
        { enterpriseProfileId: "one", enterprise: "Riverside Museum", attractionCode: "205", unique: 30 },
        { enterpriseProfileId: "two", enterprise: "Riverside Park", attractionCode: "411", unique: 40 },
      ]),
    ];

    const form = buildVar3(reports, 2026);
    expect(form.attractions).toEqual([
      { key: "one:411", name: "Riverside", code: "411" },
      { key: "one:205", name: "Riverside Museum", code: "205" },
      { key: "two:411", name: "Riverside Park", code: "411" },
    ]);
    expect(form.totals.map((cells) => cells[2])).toEqual([10, 30, 60]);
    expect(form.grand[2]).toBe(100);
  });

  it("counts every Philippine residence as domestic", () => {
    expect(var3Cells(100, allocated)).toEqual([88, 12, 100]);
    expect(var3Cells(100, null)).toEqual([null, null, 100]);
  });

  it("compiles only finalized months and leaves the others blank", () => {
    const reports = [
      finalReport("may", "May 2026", "Finalized", [
        { enterprise: "Plaza", unique: 100, demographics: allocated },
        { enterprise: "Museum", unique: 40 },
      ]),
      finalReport("june", "June 2026", "Finalized", [{ enterprise: "Plaza", unique: 50 }]),
      finalReport("july", "July 2026", "Draft", [{ enterprise: "Plaza", unique: 999 }]),
      finalReport("august", "August 2026", "Archived", [{ enterprise: "Plaza", unique: 999 }]),
      finalReport("old", "May 2025", "Finalized", [{ enterprise: "Old Fort", unique: 5 }]),
    ];

    const form = buildVar3(reports, 2026);

    expect(form.attractions.map((attraction) => attraction.name)).toEqual(["Museum", "Plaza"]);
    expect(form.months[4]).toMatchObject({
      finalized: true,
      cells: [
        [null, null, 40],
        [88, 12, 100],
      ],
      grand: [88, 12, 140],
    });
    expect(form.months[5].cells).toEqual([
      [null, null, null],
      [null, null, 50],
    ]);
    expect(form.months[6]).toMatchObject({ finalized: false, grand: [null, null, null] });
    expect(form.totals).toEqual([
      [null, null, 40],
      [88, 12, 150],
    ]);
    expect(form.grand).toEqual([88, 12, 190]);
    expect(form.period).toBe("January - December 2026");
    expect(form.notes[0]).toBe("No finalized monthly report (VAR 2M) for January, February, March, April, July, August, September, October, November and December.");
    expect(var3Years(reports)).toEqual([2026, 2025]);
  });
});

describe("Generated reports", () => {
  it("finds a report by any included establishment and applies period filters", () => {
    const archived = finalReport("CON-MAY-2025", "May 2025", "Archived", [{ enterprise: "Park" }, { enterprise: "Riverside Museum" }]);
    const current = finalReport("CON-JUN-2026", "June 2026", "Finalized", [{ enterprise: "Riverside Museum" }]);
    const filters = { query: "  riverside MUSEUM ", year: "", month: "" };

    expect(filterGeneratedReports([current, archived], filters)).toEqual([current, archived]);
    expect(filterGeneratedReports([current, archived], { ...filters, year: "2025", month: "May" })).toEqual([archived]);
    expect(filterGeneratedReports([current, archived], { ...filters, year: "2025", month: "June" })).toEqual([]);
  });
});
