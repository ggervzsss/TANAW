import { describe, expect, it } from "vitest";
import type { FinalReport } from "@/shared/types";
import { buildFinalReportSourceRow, buildFinalReportTotalRow, createTableRows, paginateTableRows } from "./pdfReportLayout";

const report: FinalReport = {
  id: "CON-MAY-2026-0001",
  title: "Citywide Tourism Aggregation",
  period: "May 2026",
  generatedOn: "May 31, 2026",
  preparedBy: "LGU Staff",
  preparedRole: "Staff Processing Division",
  status: "Finalized",
  totalEntry: 270,
  totalExit: 250,
  totalUnique: 999,
  enterpriseCount: 2,
  sources: [
    { id: "one", enterprise: "One", code: "REP-1", unique: 100, entry: 150, exit: 140 },
    { id: "two", enterprise: "Two", code: "REP-2", unique: 200, entry: 120, exit: 110 },
  ],
};

describe("report PDF document model", () => {
  it("derives source and consolidated rows from immutable report sources", () => {
    const sourceRow = buildFinalReportSourceRow(report.sources[0], report.period);
    const totalRow = buildFinalReportTotalRow(report);

    expect(sourceRow[0].value).toBe("One\nMay 2026");
    expect(sourceRow.at(-1)?.value).toBe(100);
    expect(totalRow[0].value).toBe("Citywide Consolidated Total");
    expect(totalRow.at(-1)?.value).toBe(300);
  });

  it("paginates deterministically without mutating its source rows", () => {
    const rows = createTableRows(report.sources.map((source) => buildFinalReportSourceRow(source, report.period)));
    const original = [...rows];
    const totalRow = createTableRows([buildFinalReportTotalRow(report)], true)[0];

    expect(paginateTableRows(rows, totalRow, 350)).toEqual([rows]);
    expect(rows).toEqual(original);
    expect(paginateTableRows([], totalRow, 350)).toEqual([[]]);
  });
});
