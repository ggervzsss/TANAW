import { describe, expect, it } from "vitest";
import { enterpriseReportDetailFixture } from "../testFixtures";
import { buildEnterpriseReportPdf } from "./pdf";

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

  it("keeps a missing audit actor explicit", () => {
    const enterpriseReport = enterpriseReportDetailFixture();
    enterpriseReport.reviewEvents[0]!.actor = { accountId: null, displayName: null, role: null };

    const enterprisePdf = buildEnterpriseReportPdf(enterpriseReport);

    expect(enterprisePdf).toContain("Actor not recorded; Role not recorded");
    expect(enterprisePdf).not.toContain("System actor");
  });

  it("keeps each generated snapshot bound to events for its exact immutable revision", () => {
    const enterpriseReport = enterpriseReportDetailFixture();
    enterpriseReport.reviewEvents.push({
      ...enterpriseReport.reviewEvents[0]!,
      reviewEventId: "00000000-0000-0000-0000-000000009901",
      reportRevisionId: "00000000-0000-0000-0000-000000009902",
      reason: "Event from another revision must not enter this snapshot.",
    });
    expect(buildEnterpriseReportPdf(enterpriseReport)).not.toContain("another revision");
  });
});
