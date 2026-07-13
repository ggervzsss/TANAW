import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { buildFinalReportPdf, buildIntakeReportPdf } from "./pdf";

describe("official report PDF content", () => {
  it("writes explicit missing values without generating demographic ratios", () => {
    const report: IntakeReport = {
      id: "INTAKE-1",
      enterpriseId: "enterprise-1",
      enterprise: "Example Enterprise",
      category: "Attraction",
      barangay: "Poblacion",
      month: "June",
      period: "June 2026",
      submitted: "",
      status: "Pending Review",
      code: "EX-1",
      metrics: { entry: 120, exit: 90, unique: 100, peak: "" },
      payload: null,
      demographics: null,
    };

    const pdf = buildIntakeReportPdf(report);

    expect(pdf).toContain("(Not) Tj");
    expect(pdf).toContain("(provided) Tj");
    expect(pdf).toContain("(Not recorded) Tj");
    expect(pdf).not.toContain("(31) Tj");
    expect(pdf).not.toContain("(33) Tj");
    expect(pdf).not.toContain("Estimated Data");
  });

  it("does not preserve a known placeholder actor or synthesize final-report demographics", () => {
    const report: FinalReport = {
      id: "FINAL-1",
      title: "Consolidated Report",
      period: "June 2026",
      generatedOn: "",
      preparedBy: "LGU Staff",
      preparedRole: "",
      status: "Draft",
      totalEntry: 120,
      totalExit: 90,
      totalUnique: 100,
      enterpriseCount: 1,
      sources: [{ id: "source-1", enterprise: "Example Enterprise", code: "EX-1", unique: 100, entry: 120, exit: 90, demographics: null }],
    };

    const pdf = buildFinalReportPdf(report);

    expect(pdf).toContain("(Not) Tj");
    expect(pdf).toContain("(provided) Tj");
    expect(pdf).toContain(String.raw`(Not recorded \(Role not recorded\)) Tj`);
    expect(pdf).not.toContain("(LGU Staff");
    expect(pdf).not.toContain("(31) Tj");
    expect(pdf).not.toContain("Citywide Consolidated Total");
  });
});
