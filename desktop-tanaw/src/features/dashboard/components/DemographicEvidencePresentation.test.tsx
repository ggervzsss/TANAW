import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportRecord } from "../../../types/enterprise";
import { DemographicsBreakdownChart } from "./DemographicsBreakdownChart";
import { SubmissionLedgerPreview } from "./SubmissionLedgerPreview";

describe("dashboard demographic evidence presentation", () => {
  it("shows partial facts without inventing a percentage or comparing them to the camera estimate", () => {
    const report = partialReport();
    const chart = renderToStaticMarkup(<DemographicsBreakdownChart report={report} />);
    const ledger = renderToStaticMarkup(<SubmissionLedgerPreview reports={[report]} onPreviewReport={() => undefined} />);

    expect(chart).toContain("Partial operator facts are shown below");
    expect(chart).toContain("30");
    expect(chart).toContain("Not provided");
    expect(chart).not.toContain("30%");
    expect(chart).not.toContain("over cap");
    expect(chart).not.toContain("remaining");
    expect(ledger).toContain("Camera estimate");
    expect(ledger).toContain("Explicit operator facts");
    expect(ledger).not.toContain("over cap");
    expect(ledger).not.toContain("remaining");
  });
});

function partialReport(): ReportRecord {
  return {
    id: "REP-PARTIAL",
    date: "June 2026",
    status: "Submitted",
    entries: 4,
    unique: 1,
    demo: {
      thisProvMale: "30",
      thisProvFemale: "",
      otherProvMale: "",
      otherProvFemale: "",
      foreignMale: "",
      foreignFemale: "",
    },
    demographicEvidence: {
      provenance: "operator_entered",
      quality: "confirmed",
    },
  };
}
