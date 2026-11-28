import { describe, expect, it } from "vitest";
import type { ReportLedgerRow } from "../../../../../../src/features/reports/components/ReportLedgerTable";
import { reportMonthRows, sortReportLedgerRows } from "../../../../../../src/features/reports/utils/report-ledger";

describe("sortReportLedgerRows", () => {
  it("orders current, submitted, pending, and consolidated reports by newest period", () => {
    const rows = [
      row("pending-march", "pending", "March 2026"),
      row("pending-may", "pending", "May 2026"),
      row("history-june", "history", "June 2026"),
      row("history-february", "history", "February 2026"),
      row("current-july", "current", "July 2026"),
      row("pending-april", "pending", "April 2026"),
    ];

    expect(sortReportLedgerRows(rows).map((item) => item.key)).toEqual(["current-july", "history-june", "pending-may", "pending-april", "pending-march", "history-february"]);
    expect(rows[0]?.key).toBe("pending-march");
  });
});

describe("reportMonthRows", () => {
  it("lists each reporting month once, oldest first, preferring the live month and then its submitted report", () => {
    const rows = [
      row("current-november", "current", "November 2026"),
      row("pending-october", "pending", "October 2026"),
      row("history-october", "history", "October 2026"),
      row("pending-august", "pending", "August 2026"),
      row("history-june", "history", "June 2026"),
    ];

    expect(reportMonthRows(rows).map((item) => item.key)).toEqual(["history-june", "pending-august", "history-october", "current-november"]);
  });

  it("opens a month being fixed on its draft, and lists the fixed report before the refused one", () => {
    const refused = {
      ...row("history-october-1", "history", "October 2026"),
      report: { ...row("history-october-1", "history", "October 2026").report, syncStatus: "upload_rejected", reopenedAt: "2026-11-06T00:00:00Z", submittedAt: "2026-11-05T00:00:00Z" },
    };
    const fixed = { ...row("history-october-2", "history", "October 2026"), report: { ...row("history-october-2", "history", "October 2026").report, submittedAt: "2026-11-04T00:00:00Z" } };
    const fixing = [refused, row("pending-october", "pending", "October 2026")];
    expect(reportMonthRows(fixing).map((item) => item.key)).toEqual(["pending-october"]);
    expect(sortReportLedgerRows(fixing).map((item) => item.key)).toEqual(["pending-october", "history-october-1"]);
    expect(sortReportLedgerRows([refused, fixed]).map((item) => item.key)).toEqual(["history-october-2", "history-october-1"]);
    expect(reportMonthRows([refused, fixed]).map((item) => item.key)).toEqual(["history-october-2"]);
  });
});

function row(key: string, kind: ReportLedgerRow["kind"], period: string): ReportLedgerRow {
  return {
    key,
    kind,
    report: {
      id: key,
      date: period,
      period,
      status: kind === "pending" ? "Draft" : "Submitted",
      entries: 1,
      unique: 1,
    },
    reportLabel: key,
    reportDescription: key,
    statusLabel: "Pending",
  };
}
