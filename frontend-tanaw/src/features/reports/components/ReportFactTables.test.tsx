import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { enterpriseReportDetailFixture, finalReportDetailFixture } from "../testFixtures";
import { FinalSnapshotFactTable, ReportMetricTable } from "./ReportFactTables";

describe("report fact presentation", () => {
  it("renders submitted values without technical evidence columns", () => {
    const html = renderToStaticMarkup(<ReportMetricTable report={enterpriseReportDetailFixture()} />);

    expect(html).toContain("0.100000");
    expect(html).toContain("Report totals");
    expect(html).not.toContain("camera derived");
    expect(html).not.toContain("Provenance");
    expect(html).not.toContain("Coverage");
    expect(html).toContain("0.1000%");
  });

  it("shows missing evidence explicitly instead of fabricating zeros", () => {
    const report = enterpriseReportDetailFixture();
    report.revisions[0]!.demographics = [];
    report.revisions[0]!.metrics = [];
    const html = renderToStaticMarkup(<ReportMetricTable report={report} />);

    expect(html).toContain("No totals were submitted");
    expect(html).toContain("No demographics were submitted");
    expect(html).not.toContain(">0<");
  });

  it("renders the selected final-report values in plain language", () => {
    const report = finalReportDetailFixture();
    const html = renderToStaticMarkup(<FinalSnapshotFactTable report={report} />);

    expect(html).toContain("0.100000");
    expect(html).toContain("0.1000%");
    expect(html).toContain("Final totals");
    expect(html).not.toContain("Aggregation");
    expect(html).not.toContain("Source facts");
  });
});
