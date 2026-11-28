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
  statusLabel: "Pending",
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
  reportLabel: "Report not sent",
  reportDescription: "Prepared counts",
  statusLabel: "Missing",
};

const consolidatedRow: ReportLedgerRow = {
  key: "history",
  kind: "history",
  report: {
    id: "REP-202605",
    date: "May 2026",
    period: "May 2026",
    status: "Consolidated",
    entries: 300,
    unique: 280,
    submittedAt: "2026-06-02T02:00:00Z",
  },
  reportLabel: "REP-202605",
  reportDescription: "Saved report",
  statusLabel: "Consolidated",
};

const submittedRow: ReportLedgerRow = {
  key: "submitted",
  kind: "history",
  report: {
    id: "REP-202604",
    date: "April 2026",
    period: "April 2026",
    status: "Submitted",
    entries: 210,
    unique: 190,
    submittedAt: "2026-05-04T02:00:00Z",
    syncStatus: "synced",
  },
  reportLabel: "REP-202604",
  reportDescription: "Online copy: Up to date",
  statusLabel: "Submitted",
};

function render(rows: ReportLedgerRow[], activeLedgerKey = rows[0].key) {
  return renderToStaticMarkup(<ReportLedgerTable activeLedgerKey={activeLedgerKey} ledgerRows={rows} onPreviewReport={() => undefined} onSelectReport={() => undefined} />);
}

describe("ReportLedgerTable layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T02:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("shows six columns and ends each row with a chevron instead of actions", () => {
    const markup = render([currentRow]);

    for (const heading of ["Report ID", "Reporting Period", "Visitor Counted", "Status", "Date Submitted", "Time"]) expect(markup).toContain(`<th scope="col">${heading}</th>`);
    expect(markup).not.toContain(">Actions<");
    expect(markup).not.toContain("View report");
    expect(markup).not.toContain("Download PDF");
    expect(markup).toContain('class="report-history-open" aria-hidden="true"');
    // The whole row opens the report, from the pointer or the keyboard.
    expect(markup).toContain('role="button" tabindex="0" aria-selected="true" aria-label="Current Reporting Period, July 2026, Pending"');
    expect(markup).not.toContain("Apply Filter");
    expect(markup).toContain('aria-label="Filter reports by reporting period"');
    expect(markup).toContain('aria-label="Filter reports by status"');
  });

  it("tints Pending amber, Submitted teal, Missing red and Consolidated green", () => {
    const markup = render([currentRow, pendingRow, consolidatedRow, submittedRow]);

    expect(markup).toContain('data-tone="pending">Pending</span>');
    expect(markup).toContain('data-tone="submitted">Submitted</span>');
    expect(markup).toContain('data-tone="missing">Missing</span>');
    expect(markup).toContain('data-tone="consolidated">Consolidated</span>');
  });

  it("says when a month not submitted yet is due, or was", () => {
    const markup = render([currentRow, pendingRow, submittedRow]);

    expect(markup).toContain("Due Aug 10, 2026");
    expect(markup).toContain("Was due Jul 10, 2026");
    expect(markup).not.toContain("Due May 10, 2026");
  });


  it("renders canonical month and year labels", () => {
    const markup = render([pendingRow]);

    expect(markup).toContain("June 2026");
    expect(markup).not.toContain("Jun 1 - Jun 30, 2026");
  });
});
