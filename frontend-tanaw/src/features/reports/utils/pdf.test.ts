import { describe, expect, it } from "vitest";
import { enterpriseReportDetailFixture, finalReportDetailFixture } from "../testFixtures";
import { buildEnterpriseReportPdf, buildFinalReportSnapshotPdf } from "./pdf";

describe("authoritative report PDF content", () => {
  it("writes report evidence, exact decimals, coverage gaps, and immutable actors", () => {
    const pdf = buildEnterpriseReportPdf(enterpriseReportDetailFixture());

    expect(pdf).toContain("TANAW Official Enterprise Report Evidence");
    expect(pdf).toContain("Frozen Enterprise");
    expect(pdf).toContain("0.100000 events");
    expect(pdf).toContain("stream unavailable: 10 seconds");
    expect(pdf).toContain("Recorded Staff");
    expect(pdf).not.toContain("Estimated demographic");
  });

  it("builds a final PDF from selected-version snapshot facts and real events only", () => {
    const report = finalReportDetailFixture();
    const pdf = buildFinalReportSnapshotPdf(report);

    expect(pdf).toContain("TANAW Immutable Final Report Snapshot");
    expect(pdf).toContain("Frozen Enterprise");
    expect(pdf).toContain("Frozen Site");
    expect(pdf).toContain("0.100000 events");
    expect(pdf).toContain(report.selectedVersion.contentHash);
    expect(pdf).toContain(report.selectedVersion.items[0]!.reportRevisionId);
    expect(pdf).toContain("Recorded Staff");
    expect(pdf).not.toContain("Checked By");
    expect(pdf).not.toContain("Approved By");
  });

  it("keeps missing audit actors explicit in both PDFs", () => {
    const enterpriseReport = enterpriseReportDetailFixture();
    enterpriseReport.reviewEvents[0]!.actor = { accountId: null, displayName: null, role: null };
    const finalReport = finalReportDetailFixture();
    finalReport.events[0] = { ...finalReport.events[0]!, actorAccountId: null, actorDisplayName: null, actorRole: null };

    const enterprisePdf = buildEnterpriseReportPdf(enterpriseReport);
    const finalPdf = buildFinalReportSnapshotPdf(finalReport);

    expect(enterprisePdf).toContain("Actor not recorded; Role not recorded");
    expect(finalPdf).toContain("Actor not recorded; Role not recorded");
    expect(enterprisePdf).not.toContain("System actor");
    expect(finalPdf).not.toContain("System actor");
  });

  it("keeps each generated snapshot bound to events for its exact immutable revision or version", () => {
    const enterpriseReport = enterpriseReportDetailFixture();
    enterpriseReport.reviewEvents.push({
      ...enterpriseReport.reviewEvents[0]!,
      reviewEventId: "00000000-0000-0000-0000-000000009901",
      reportRevisionId: "00000000-0000-0000-0000-000000009902",
      reason: "Event from another revision must not enter this snapshot.",
    });
    const finalReport = finalReportDetailFixture();
    finalReport.events.push({
      ...finalReport.events[0]!,
      finalReportEventId: "00000000-0000-0000-0000-000000009903",
      finalReportVersionId: "00000000-0000-0000-0000-000000009904",
      reason: "Event from another version must not enter this snapshot.",
    });

    expect(buildEnterpriseReportPdf(enterpriseReport)).not.toContain("another revision");
    expect(buildFinalReportSnapshotPdf(finalReport)).not.toContain("another version");
  });
});
