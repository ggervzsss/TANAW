import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { enterpriseReportDetailFixture, finalReportDetailFixture } from "../testFixtures";
import { FinalSnapshotFactTable, ReportMetricTable } from "./ReportFactTables";

describe("authoritative report fact presentation", () => {
  it("renders exact decimal strings with provenance, quality, and recorded coverage", () => {
    const html = renderToStaticMarkup(<ReportMetricTable report={enterpriseReportDetailFixture()} />);

    expect(html).toContain("0.100000");
    expect(html).toContain("camera derived");
    expect(html).toContain("confirmed");
    expect(html).toContain("100.0%");
    expect(html).toContain("0.1000%");
  });

  it("shows missing evidence explicitly instead of fabricating zeros", () => {
    const report = enterpriseReportDetailFixture();
    report.revisions[0]!.demographics = [];
    report.revisions[0]!.metrics = [];
    const html = renderToStaticMarkup(<ReportMetricTable report={report} />);

    expect(html).toContain("No metric facts were recorded");
    expect(html).toContain("No demographic facts were recorded");
    expect(html).not.toContain(">0<");
  });

  it("renders only immutable selected-version facts in final report tables", () => {
    const report = finalReportDetailFixture();
    const html = renderToStaticMarkup(<FinalSnapshotFactTable report={report} />);

    expect(html).toContain("0.100000");
    expect(html).toContain("0.1000%");
    expect(html).toContain("sum");
    expect(html).toContain("1 source facts");
  });
});
