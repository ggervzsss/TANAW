import { describe, expect, it } from "vitest";
import { createDotReportPdf } from "./pdf";

describe("enterprise DOT PDF generation", () => {
  it("matches the dark preview content and uses valid PDF text positioning", () => {
    const pdf = createDotReportPdf(
      {
        reportId: "REP-260501",
        period: "May 2026",
        metrics: { entries: 598, exits: 571, peak: 54, unique: 377 },
        demo: {
          thisProvMale: "111",
          thisProvFemale: "107",
          otherProvMale: "52",
          otherProvFemale: "49",
          foreignMale: "31",
          foreignFemale: "27",
        },
        notes: "Monthly visitor count submitted for LGU review.",
      },
      "dark",
    );

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("TANAW - DOT Visitor Attraction Report");
    expect(pdf).toContain("VISITOR ATTRACTION");
    expect(pdf).toContain("REP-260501");
    expect(pdf).toContain("0.043 0.071 0.125 rg 0 0 792 612 re f");
    expect(pdf).not.toContain("stringwidth");
  });
});
