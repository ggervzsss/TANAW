import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport } from "@/shared/types";
import { FinalReportAuditNotice } from "./FinalReportViewer";
import { CameraSourceLineageNotice } from "./ReportReviewModal";
import { DotFinalReportTable, DotSingleReportTable } from "./DotReportTable";

describe("official report presentation", () => {
  it("renders absent intake demographics as not provided without estimated values", () => {
    const html = renderToStaticMarkup(<DotSingleReportTable report={intakeReport()} />);

    expect(html).toContain("Place of Residence (Submitted Data)");
    expect(html).toContain("Not provided");
    expect(html).toContain("Missing or inconsistent values are not estimated");
    expect(html).not.toContain("Estimated Data");
    expect(html).not.toMatch(/>31<|>33<|>12<|>5<|>7</);
  });

  it("marks consolidated demographics incomplete when any source is missing", () => {
    const report: FinalReport = {
      id: "FINAL-1",
      title: "Consolidated Report",
      period: "June 2026",
      generatedOn: "",
      preparedBy: "",
      preparedRole: "",
      status: "Draft",
      totalEntry: 150,
      totalExit: 100,
      totalUnique: 110,
      enterpriseCount: 2,
      sources: [
        {
          id: "source-1",
          enterprise: "Recorded Enterprise",
          code: "REC",
          unique: 10,
          entry: 20,
          exit: 10,
          demographics: {
            thisProvMale: 2,
            thisProvFemale: 2,
            otherProvMale: 2,
            otherProvFemale: 2,
            foreignMale: 1,
            foreignFemale: 1,
          },
        },
        { id: "source-2", enterprise: "Unknown Enterprise", code: "UNK", unique: 100, entry: 130, exit: 90, demographics: null },
      ],
    };

    const html = renderToStaticMarkup(<DotFinalReportTable report={report} />);

    expect(html).toContain("Incomplete");
    expect(html).toContain("Consolidated Total");
    expect(html).not.toContain("Citywide Consolidated Total");
  });

  it("does not turn an absent final-report source set into a zero visitor total", () => {
    const report: FinalReport = {
      id: "FINAL-EMPTY",
      title: "Consolidated Report",
      period: "June 2026",
      generatedOn: "",
      preparedBy: "",
      preparedRole: "",
      status: "Draft",
      totalEntry: 0,
      totalExit: 0,
      totalUnique: 0,
      enterpriseCount: 0,
      sources: [],
    };

    const html = renderToStaticMarkup(<DotFinalReportTable report={report} />);

    expect(html).toContain("Insufficient source data");
    expect(html).toContain("Not provided");
  });

  it("shows an explicit missing-lineage notice without inventing cameras or contributions", () => {
    const html = renderToStaticMarkup(<CameraSourceLineageNotice />);

    expect(html).toContain("Not recorded in this report payload");
    expect(html).not.toContain("Zone A");
    expect(html).not.toContain("Zone B");
    expect(html).not.toContain("23:55:01");
    expect(html).not.toContain("23:58:12");
  });

  it("does not synthesize final-report audit versions, actors, or timestamps", () => {
    const html = renderToStaticMarkup(<FinalReportAuditNotice status="Finalized" />);

    expect(html).toContain("Audit events, event actors, and event timestamps are not included");
    expect(html).toContain("Current workflow status: Finalized");
    expect(html).not.toContain("System Pipeline");
    expect(html).not.toContain("v1.0");
    expect(html).not.toContain("04:15 AM");
    expect(html).not.toContain("09:30 AM");
  });
});

function intakeReport(): IntakeReport {
  return {
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
}
