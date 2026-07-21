import { describe, expect, it } from "vitest";
import { createDotReportPdf } from "./pdf";

describe("enterprise DOT PDF generation", () => {
  it("always generates an official light PDF with valid text positioning", () => {
    const pdf = createDotReportPdf({
      enterpriseName: "Archie's Event Place",
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
    });

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("TANAW - DOT Visitor Attraction Report");
    expect(pdf).toContain("Tourism Attraction Visitor Record - VAR 2");
    expect(pdf).toContain("Visitor Attraction");
    expect(pdf).toContain("REP-260501");
    expect(pdf).toContain("Archie's Event Place");
    expect(pdf).toContain("UNIQUE VISITORS");
    expect(pdf).toContain("City of San Pedro, Laguna");
    expect(pdf).toContain("Place of Residence");
    expect(pdf).toContain("Grand Total");
    expect(pdf).toContain("(194) Tj");
    expect(pdf).toContain("(183) Tj");
    expect(pdf).toContain("(377) Tj");
    expect(pdf).toContain("Page 1 of 1");
    expect(pdf).not.toContain("SPL-MKT-01");
    expect(pdf).not.toContain("Enterprise Node");
    expect(pdf).not.toContain("***Place of Residence");
    expect(pdf).toContain("1 1 1 rg 0 0 842 595 re f");
    expect(pdf).not.toContain("0.043 0.071 0.125 rg");
    expect(pdf).not.toContain("stringwidth");
  });

  it("preserves long notes on continuation pages and transliterates unsupported characters", () => {
    const notes = Array.from({ length: 70 }, (_, index) => `Supporting submission detail ${index + 1}`).join(" ");
    const pdf = createDotReportPdf({
      enterpriseName: "José Niño’s Tourism Destination With A Deliberately Long Registered Name",
      reportId: "REP-260502",
      period: "May 2026",
      metrics: { entries: 598, exits: 571, peak: 54, unique: 3 },
      demo: {
        thisProvMale: "1",
        thisProvFemale: "1",
        otherProvMale: "1",
        otherProvFemale: "0",
        foreignMale: "0",
        foreignFemale: "0",
      },
      notes,
    });

    expect(pdf).toContain("Jos\\351 Ni\\361o's Tourism");
    expect(pdf).toContain("Supporting submission detail 70");
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("Page 2 of 2");
  });
});
