import { describe, expect, it } from "vitest";
import type { DemoBreakdown } from "../../../types/enterprise";
import { CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE } from "./demographics";
import { createDotReportPdf } from "./pdf";

describe("DOT report PDF", () => {
  it("renders missing identity and demographic evidence as Not provided", () => {
    const pdf = createDotReportPdf({
      reportId: "REP-1",
      period: "June 2026",
      metrics: { entries: 12, exits: 2, peak: 10, unique: 10 },
      demo: emptyDemo(),
      demographicEvidence: null,
      notes: "",
    });

    expect(pdf).toContain("Not provided");
    expect(pdf).not.toContain("SPL-MKT-01");
    expect(pdf).not.toContain("Enterprise Node");
    expect(pdf).not.toContain("50%");
  });

  it("preserves explicit identity and confirmed operator counts exactly", () => {
    const pdf = createDotReportPdf({
      attractionCode: "ATTR-007",
      attractionName: "Riverside Museum",
      reportId: "REP-2",
      period: "June 2026",
      metrics: { entries: 12, exits: 2, peak: 10, unique: 10 },
      demo: {
        thisProvMale: "3",
        thisProvFemale: "2",
        otherProvMale: "1",
        otherProvFemale: "1",
        foreignMale: "1",
        foreignFemale: "2",
      },
      demographicEvidence: CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
      notes: "Verified against the visitor log.",
    });

    expect(pdf).toContain("ATTR-007");
    expect(pdf).toContain("Riverside Museum");
    expect(pdf).toContain("Verified against the visitor log.");
    expect(pdf).toMatch(/\(3\) Tj/);
    expect(pdf).toMatch(/\(10\) Tj/);
  });

  it("exports partial facts without synthesizing the missing categories or total", () => {
    const demo = emptyDemo();
    demo.thisProvMale = "4";
    const pdf = createDotReportPdf({
      reportId: "REP-3",
      period: "June 2026",
      metrics: { entries: 20, exits: 2, peak: 18, unique: 15 },
      demo,
      demographicEvidence: CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
      notes: "",
    });

    expect(pdf).toMatch(/\(4\) Tj/);
    expect(pdf).toContain("Not provided");
    expect(pdf).not.toContain("SPL-MKT-01");
  });
});

function emptyDemo(): DemoBreakdown {
  return {
    thisProvMale: "",
    thisProvFemale: "",
    otherProvMale: "",
    otherProvFemale: "",
    foreignMale: "",
    foreignFemale: "",
  };
}
