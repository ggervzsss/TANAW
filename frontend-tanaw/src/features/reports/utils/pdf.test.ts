import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { createFinalReportPdf, createIntakeReportPdf } from "./pdf";

const intakeReport: IntakeReport = {
  id: "2b70bc67-a0ce-410d-98cb-38bc6e0f14d6",
  enterpriseId: "enterprise-1",
  enterprise: "Archie's Event Place",
  category: "Tourism",
  barangay: "San Antonio",
  month: "May 2026",
  period: "May 1 - May 31, 2026",
  submitted: "2026-05-31T10:15:00Z",
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
    expect(pdf).toContain("Tourism Attraction Visitor Record");
    expect(pdf).toContain("Archie's Event Place");
    expect(pdf).toContain("Report Code");
    expect(pdf).toContain("Philippines");
    expect(pdf).toContain("This Province");
    expect(pdf).toContain("Other Province");
    expect(pdf).toContain("Foreign Country Residence");
    expect(pdf).toContain("Grand Total Number of Visitors");
    expect(pdf).toContain("Live Count Summary");
    expect(pdf).toContain("May 31, 2026, 6:15 PM Philippine Time");
    expect(pdf).toContain("Demographic splits and unique visitors are estimates");
    expect(pdf).not.toContain(intakeReport.id);
    expect(pdf).toContain("1 1 1 rg 0 0 842 595 re f");
    expect(pdf).not.toContain("0.043 0.071 0.125 rg");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
  });

  it("preserves long report content and safely transliterates submission text", () => {
    const pdf = createIntakeReportPdf({
      ...intakeReport,
      enterprise: "José’s Cafe and Niño’s Tourism Destination With A Deliberately Long Registered Enterprise Name",
      remarks: `First review line ${"supporting detail ".repeat(400)}FINAL-REMARK`,
    });

    expect(pdf).toContain("Jos\\351's Cafe");
    expect(pdf).toContain("Ni\\361o's Tourism");
    expect(pdf).toContain("FINAL-REMARK");
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("Page 2 of 2");
    expect(pdf).not.toContain("Jos s Cafe");
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

  it("derives the final total from its source rows instead of trusting stale summary data", () => {
    const report: FinalReport = {
      id: "CON-MAY-2026-0002",
      title: "Citywide Tourism Aggregation",
      period: "May 2026",
      generatedOn: "May 31, 2026",
      preparedBy: "LGU Staff",
      preparedRole: "Staff Processing Division",
      status: "Finalized",
      totalEntry: 30,
      totalExit: 25,
      totalUnique: 999_999,
      enterpriseCount: 2,
      sources: [
        { id: "one", enterprise: "One", code: "REP-1", unique: 100, entry: 15, exit: 12 },
        { id: "two", enterprise: "Two", code: "REP-2", unique: 200, entry: 15, exit: 13 },
      ],
    };

    const pdf = createFinalReportPdf(report);
    expect(pdf).toContain("(300) Tj");
    expect(pdf).not.toContain("999,999");
  });
});
