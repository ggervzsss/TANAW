import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { createFinalReportPdf, createIntakeReportPdf } from "./pdf";

const intakeReport: IntakeReport = {
  id: "REP-260501",
  enterpriseId: "enterprise-1",
  enterprise: "Archie's Event Place",
  category: "Tourism",
  barangay: "San Antonio",
  month: "May 2026",
  period: "May 1 - May 31, 2026",
  submitted: "May 31, 2026",
  status: "Ready to Consolidate",
  code: "REP-260501",
  remarks: "Monthly visitor count submitted for LGU review.",
  metrics: { entry: 598, exit: 571, peak: "54", unique: 377 },
};

describe("web report PDF generation", () => {
  it("builds an official light intake document containing the report content", () => {
    const pdf = createIntakeReportPdf(intakeReport);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("TANAW - DOT Visitor Attraction Report");
    expect(pdf).toContain("Archie's Event Place");
    expect(pdf).toContain("Live Count Summary");
    expect(pdf).toContain("1 1 1 rg 0 0 842 595 re f");
    expect(pdf).not.toContain("0.043 0.071 0.125 rg");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
  });

  it("paginates consolidated sources without dropping the total row", () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({
      id: `source-${index}`,
      enterprise: `Enterprise ${index + 1}`,
      code: `REP-${index + 1}`,
      unique: 100 + index,
      entry: 120 + index,
      exit: 110 + index,
    }));
    const report: FinalReport = {
      id: "CON-MAY-2026-0001",
      title: "Citywide Tourism Aggregation",
      period: "May 2026",
      generatedOn: "May 31, 2026",
      preparedBy: "LGU Staff",
      preparedRole: "Staff Processing Division",
      status: "Finalized",
      totalEntry: sources.reduce((sum, source) => sum + source.entry, 0),
      totalExit: sources.reduce((sum, source) => sum + source.exit, 0),
      totalUnique: sources.reduce((sum, source) => sum + source.unique, 0),
      enterpriseCount: sources.length,
      sources,
    };

    const pdf = createFinalReportPdf(report);
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("Citywide Consolidated Total");
    expect(pdf).toContain("APPROVED BY");
    expect(pdf).toContain("Page 2 of 2");
  });
});
