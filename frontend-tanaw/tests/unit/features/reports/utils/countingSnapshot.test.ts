import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { createFinalReportPdf, createIntakeReportPdf } from "../../../../../src/features/reports/utils/pdf";

const saved = JSON.parse(readFileSync(new URL("../../../../../../desktop-tanaw/ml-service/tests/fixtures/reports/open-space-establishment-report.json", import.meta.url), "utf8"));
const intake: IntakeReport = {
  id: "frozen-source",
  enterpriseId: "park-fixture",
  enterprise: "Park",
  category: "Parks",
  attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
  barangay: "Poblacion",
  month: "October",
  period: saved.period,
  submitted: saved.submitted_at,
  submittedAt: saved.submitted_at,
  status: "Ready to Consolidate",
  code: saved.report_id,
  version: 1,
  metrics: { entry: saved.entries, exit: saved.exits, unique: saved.unique_count, peak: String(saved.peak_occupancy) },
  payload: saved.payload,
};
const final: FinalReport = {
  id: "CON-OCT-2026-0001",
  title: "Citywide Tourism Aggregation",
  period: saved.period,
  generatedOn: "2026-11-03",
  preparedBy: "Staff Reviewer",
  preparedRole: "Staff Processing Division",
  status: "Finalized",
  enterpriseCount: 1,
  totalEntry: null,
  totalExit: null,
  totalUnique: saved.unique_count,
  sources: [
    {
      id: intake.id,
      enterprise: intake.enterprise,
      enterpriseProfileId: "park-profile",
      attractionCode: intake.attraction.code,
      code: intake.code,
      unique: saved.unique_count,
      entry: null,
      exit: null,
      counting: saved.counting,
      demographics: { thisProvMale: 1, thisProvFemale: 1, thisProvUnspecified: 0, otherProvMale: 0, otherProvFemale: 0, foreignMale: 0, foreignFemale: 0 },
    },
  ],
};

describe("Staff exports of the saved unified desktop snapshot", () => {
  it("uses the saved visitor total and excludes counting evidence from both exports", () => {
    const intakePdf = createIntakeReportPdf(intake);
    const finalPdf = createFinalReportPdf(final);
    for (const pdf of [intakePdf, finalPdf]) {
      expect(pdf).toContain(`(${saved.unique_count}) Tj`);
      expect(pdf).toContain("Total of this Month ****");
      expect(pdf).toContain("/Count 1");
      expect(pdf).not.toContain(saved.counting.snapshot_version);
      expect(pdf).not.toContain("Not measured");
      expect(pdf).not.toContain("daily estimates");
      expect(pdf).not.toContain("daily visitor observations");
    }
    const output = process.env.TANAW_PDF_REVIEW_DIR;
    if (output) {
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "staff-intake.pdf"), intakePdf, "binary");
      writeFileSync(join(output, "staff-consolidated.pdf"), finalPdf, "binary");
    }
  });
});
