import { describe, expect, it } from "vitest";
import type { ReportLedgerRow } from "../components/ReportLedgerTable";
import { sortReportLedgerRows } from "./report-ledger";

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
    statusLabel: key,
  };
}
