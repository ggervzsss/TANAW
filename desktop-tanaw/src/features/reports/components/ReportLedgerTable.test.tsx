import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportLedgerTable, type ReportLedgerRow } from "./ReportLedgerTable";

const currentRow: ReportLedgerRow = {
  key: "current",
  kind: "current",
  report: {
    id: "TANAW-DRAFT",
    date: "Jul 1 - Jul 31, 2026",
    period: "Jul 1 - Jul 31, 2026",
    status: "Draft",
    entries: 100,
    unique: 74,
  },
  reportLabel: "Current Reporting Period",
  reportDescription: "Live workspace",
  statusLabel: "Current Reporting Period",
};

const pendingRow: ReportLedgerRow = {
  key: "pending",
  kind: "pending",
  report: {
    id: "SAMPLE-REP-260601",
    date: "June 2026",
    period: "June 2026",
    status: "Draft",
    entries: 519,
    unique: 476,
  },
  reportLabel: "Pending Submission",
  reportDescription: "Prepared counts",
  statusLabel: "Pending Submission",
};

describe("ReportLedgerTable layout", () => {
  it("keeps long status labels and action controls on one line", () => {
    const markup = renderToStaticMarkup(
      <ReportLedgerTable activeLedgerKey="current" ledgerRows={[currentRow]} onDownloadReport={() => undefined} onPreviewReport={() => undefined} onSelectReport={() => undefined} />,
    );

    expect(markup).not.toContain("min-w-270");
    expect(markup).toContain("overflow-x-hidden");
    expect(markup).toContain('class="w-[31%]"');
    expect(markup).toContain('class="w-[15%]"');
    expect(markup).toContain("tanaw-status-badge inline-flex items-center");
    expect(markup).toContain("font-semibold whitespace-nowrap tanaw-status-badge--success");
    expect(markup).toContain("flex shrink-0 items-center");
    expect(markup).toContain('<span class="xl:hidden">Current</span>');
    expect(markup).toContain('aria-label="View Current Reporting Period"');
    expect(markup).toContain('title="View report"');
    expect(markup).toContain('aria-label="Download Current Reporting Period"');
    expect(markup).not.toContain('<span class="hidden xl:inline">View</span>');
    expect(markup).toContain("Current Reporting Period</span>");
  });

  it("renders compact stored months as complete reporting ranges", () => {
    const markup = renderToStaticMarkup(
      <ReportLedgerTable activeLedgerKey="pending" ledgerRows={[pendingRow]} onDownloadReport={() => undefined} onPreviewReport={() => undefined} onSelectReport={() => undefined} />,
    );

    expect(markup).toContain("Jun 1 - Jun 30, 2026");
    expect(markup).not.toContain(">June 2026<");
  });
});
