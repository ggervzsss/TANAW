import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { buildVar3 } from "../../../../../src/features/reports/model/varForms";
import { createAnnualReportPdf, createFinalReportPdf, createIntakeReportPdf } from "../../../../../src/features/reports/utils/pdf";

const intakeReport: IntakeReport = {
  id: "2b70bc67-a0ce-410d-98cb-38bc6e0f14d6",
  enterpriseId: "enterprise-1",
  enterprise: "Archie's Event Place",
  category: "Other Events",
  attraction: { code: "799", typeCode: "7", type: "Special Event", category: "Other Events", portfolioCategory: "MICE and Events Tourism", ntdpCode: "TD503" },
  barangay: "San Antonio",
  month: "May 2026",
  period: "May 2026",
  submitted: "2026-05-31T10:15:00Z",
  status: "Ready to Consolidate",
  code: "REP-260501",
  remarks: "Monthly visitor count submitted for LGU review.",
  metrics: { entry: 598, exit: 571, peak: "54", unique: 377 },
};

function finalReport(sources: FinalReport["sources"], overrides: Partial<FinalReport> = {}): FinalReport {
  return {
    id: "CON-MAY-2026-0001",
    title: "Citywide Tourism Aggregation",
    period: "May 2026",
    generatedOn: "May 31, 2026",
    preparedBy: "LGU Staff",
    preparedRole: "Staff Processing Division",
    status: "Finalized",
    totalEntry: sources.reduce((sum, source) => sum + (source.entry ?? 0), 0),
    totalExit: sources.reduce((sum, source) => sum + (source.exit ?? 0), 0),
    totalUnique: sources.reduce((sum, source) => sum + source.unique, 0),
    enterpriseCount: sources.length,
    enterpriseTotal: sources.length,
    generatedAt: "2026-10-09T08:00:00+08:00",
    updatedAt: "2026-10-09T08:00:00+08:00",
    sources,
    ...overrides,
  };
}

describe("VAR 2M PDF", () => {
  it("prints an intake report as its VAR 2M row on the official A4 landscape sheet", () => {
    const pdf = createIntakeReportPdf(intakeReport);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 842 595]");
    expect(pdf).toContain("(VAR 2) Tj");
    expect(pdf).toContain("(Tourism Attraction Visitor Record) Tj");
    expect(pdf).toContain("(Name of Municipality:) Tj");
    expect(pdf).toContain("(City of San Pedro) Tj");
    for (const heading of [
      "(Visitor Attraction) Tj",
      "(Attraction) Tj",
      "(Philippines) Tj",
      "(This Municipality) Tj",
      "(This Province) Tj",
      "(Other Province) Tj",
      "(Foreign Country Residence) Tj",
      "(Total of this Month ****) Tj",
    ]) {
      expect(pdf).toContain(heading);
    }
    expect(pdf).toContain("1 1 0 rg");
    expect(pdf).toContain("0.573 0.816 0.314 rg");
    expect(pdf).toContain("Archie's Event Place");
    expect(pdf).toContain("(377) Tj");
    expect(pdf).toContain("(799) Tj");
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("(REP-260501) Tj");
    expect(pdf).not.toContain("Saved Establishment Summary");
    expect(pdf).not.toContain(intakeReport.remarks);
    expect(pdf).toContain("Sex and residence were not recorded for Archie's Event Place");
    expect(pdf).not.toContain(intakeReport.id);
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
  });

  it("never invents a residence split for an unallocated report", () => {
    const pdf = createIntakeReportPdf(intakeReport);
    const numbers = [...pdf.matchAll(/\(([\d,]+)\) Tj/g)].map((match) => match[1]);
    expect(numbers.filter((value) => value === "377")).toHaveLength(2);
  });

  it("safely transliterates attraction names and omits review remarks", () => {
    const pdf = createIntakeReportPdf({
      ...intakeReport,
      enterprise: "José’s Cafe and Niño’s Tourism Destination",
      remarks: `First review line ${"supporting detail ".repeat(400)}FINAL-REMARK`,
    });

    expect(pdf).toContain("Jos\\351's Cafe");
    expect(pdf).toContain("Ni\\361o's Tourism");
    expect(pdf).not.toContain("FINAL-REMARK");
    expect(pdf).not.toContain("Jos s Cafe");
  });

  it("repeats the header across pages and keeps the monthly total on the last one", () => {
    const sources = Array.from({ length: 30 }, (_, index) => ({ id: `source-${index}`, enterprise: `Enterprise ${index + 1}`, enterpriseProfileId: `enterprise-${index}`, attractionCode: "411", code: `REP-${index + 1}`, unique: 100 + index, entry: 120, exit: 110 }));
    const pdf = createFinalReportPdf(finalReport(sources));
    const pages = pdf.split("/Type /Page /Parent").length - 1;

    expect(pages).toBeGreaterThan(1);
    expect(pdf.split("(Visitor Attraction) Tj").length - 1).toBe(pages);
    expect(pdf.split("Total of this Month").length - 1).toBe(1);
    expect(pdf).toContain(`Page ${pages} of ${pages}`);
    expect(pdf).toContain("(CON-MAY-2026-0001) Tj");
  });

  it("derives the monthly total from its source rows instead of trusting stale summary data", () => {
    const report = finalReport(
      [
        { id: "one", enterprise: "One", enterpriseProfileId: "one", attractionCode: "411", code: "REP-1", unique: 100, entry: 15, exit: 12 },
        { id: "two", enterprise: "Two", enterpriseProfileId: "two", attractionCode: "205", code: "REP-2", unique: 200, entry: 15, exit: 13 },
      ],
      { totalUnique: 999_999 },
    );

    const pdf = createFinalReportPdf(report);
    expect(pdf).toContain("(300) Tj");
    expect(pdf).not.toContain("999,999");
  });

  it("marks a draft above the sheet and in its footer, and leaves the final report unmarked", () => {
    const sources = [{ id: "one", enterprise: "One", enterpriseProfileId: "one", attractionCode: "411", code: "REP-1", unique: 100, entry: 15, exit: 12 }];
    const draft = createFinalReportPdf(finalReport(sources, { status: "Draft", enterpriseTotal: 3 }));
    expect(draft).toContain("(DRAFT - NOT FINAL \\(1 of 3 enterprises\\)) Tj");
    expect(draft).toContain("(CON-MAY-2026-0001 - DRAFT - NOT FINAL \\(1 of 3 enterprises\\)) Tj");
    expect(createFinalReportPdf(finalReport(sources))).not.toContain("DRAFT");
  });
});

describe("VAR 3M PDF", () => {
  it("prints the annual sheet with months, column groups and the grand total", () => {
    const reports = [
      finalReport([{ id: "a", enterprise: "Plaza", enterpriseProfileId: "plaza", attractionCode: "411", code: "REP-1", unique: 120, entry: null, exit: null }]),
      finalReport([{ id: "b", enterprise: "Museum", enterpriseProfileId: "museum", attractionCode: "205", code: "REP-2", unique: 80, entry: null, exit: null }], { id: "CON-JUN-2026-0001", period: "June 2026" }),
    ];
    const pdf = createAnnualReportPdf(buildVar3(reports, 2026));

    expect(pdf).toContain("(VAR 3M) Tj");
    expect(pdf).toContain("(Province:) Tj");
    expect(pdf).toContain("(Laguna) Tj");
    expect(pdf).toContain("(January - December 2026) Tj");
    for (const label of ["January", "December", "Total:", "Domestic", "Foreign", "Grand Total Visitors", "Museum - 205", "Plaza - 411"]) expect(pdf).toContain(`(${label}) Tj`);
    expect(pdf).toContain("(200) Tj");
    expect(pdf).not.toContain("Compiled from finalized monthly reports");
    expect(pdf).toContain("/Count 1");
  });

  it("continues column groups on further pages when there are more than four", () => {
    const sources = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, enterprise: `Attraction ${index + 1}`, enterpriseProfileId: `enterprise-${index}`, attractionCode: "411", code: `REP-${index}`, unique: 10, entry: null, exit: null }));
    const pdf = createAnnualReportPdf(buildVar3([finalReport(sources)], 2026));

    expect(pdf).toContain("/Count 2");
    expect(pdf.split("(Grand Total Visitors) Tj").length - 1).toBe(1);
    expect(pdf.split("(January) Tj").length - 1).toBe(2);
  });
});
