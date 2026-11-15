import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportLedgerTable, type ReportLedgerRow } from "../../../../../../src/features/reports/components/ReportLedgerTable";

const currentRow: ReportLedgerRow = {
  key: "current",
  kind: "current",
  report: {
    id: "TANAW-DRAFT",
    date: "July 2026",
    period: "July 2026",
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T02:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("exposes the seven Figma columns while retaining keyboard selection, previews and exports", () => {
    const markup = renderToStaticMarkup(
      <ReportLedgerTable activeLedgerKey="current" ledgerRows={[currentRow]} onDownloadReport={() => undefined} onPreviewReport={() => undefined} onSelectReport={() => undefined} />,
    );

    for (const heading of ["Report ID", "Reporting Period", "Visitor Counted", "Status", "Date Submitted", "Time", "Actions"]) expect(markup).toContain(`<th scope="col">${heading}</th>`);
    expect(markup).toContain('role="button" tabindex="0" aria-selected="true"');
    expect(markup).toContain("Current Reporting Period");
    expect(markup).toContain('aria-label="View Current Reporting Period"');
    expect(markup).toContain('title="View report"');
    expect(markup).toContain('aria-label="Download Current Reporting Period"');
    expect(markup).not.toContain("Apply Filter");
    expect(markup).toContain('aria-label="Filter reports by reporting period"');
    expect(markup).toContain('aria-label="Filter reports by status"');
  });

  it("renders canonical month and year labels", () => {
    const markup = renderToStaticMarkup(
      <ReportLedgerTable activeLedgerKey="pending" ledgerRows={[pendingRow]} onDownloadReport={() => undefined} onPreviewReport={() => undefined} onSelectReport={() => undefined} />,
    );

    expect(markup).toContain("June 2026");
    expect(markup).not.toContain("Jun 1 - Jun 30, 2026");
  });
});
