import { describe, expect, it } from "vitest";
import type { ReportRecord } from "../../../../../../src/types/enterprise";
import type { ReportLedgerRow } from "../../../../../../src/features/reports/model/report-ledger";
import { REFUSED_REPORT_BLOCKER, WAITING_REPORT_BLOCKER, previewActions, previewLedgerRow, sentReportBlocker, type PreviewedReport } from "../../../../../../src/features/reports/model/report-preview";

const NOW = new Date("2026-11-28T04:00:00Z");
const METRICS = { entries: null, exits: null, peak: null, unique: 0 };

function row(kind: ReportLedgerRow["kind"], statusLabel: ReportLedgerRow["statusLabel"], report: Partial<ReportRecord>): ReportLedgerRow {
  const full: ReportRecord = { id: "REP-1", date: "October 2026", period: "October 2026", status: "Draft", entries: 0, unique: 0, ...report };
  return { key: `${kind}:${full.id}`, kind, report: full, reportLabel: full.id, reportDescription: "", statusLabel };
}

const current = row("current", "Pending", { id: "TANAW-DRAFT", date: "November 2026", period: "November 2026" });
const october = row("pending", "Missing", { id: "PENDING-2026-10" });
const september = row("history", "Submitted", { id: "REP-SEP", date: "September 2026", period: "September 2026", status: "Submitted", syncStatus: "synced" });
const august = row("history", "Consolidated", { id: "REP-AUG", date: "August 2026", period: "August 2026", status: "Consolidated" });
const refused = row("history", "Missing", { id: "REP-JUL", date: "July 2026", period: "July 2026", status: "Submitted", syncStatus: "upload_rejected" });
const waiting = row("history", "Missing", { id: "REP-JUN", date: "June 2026", period: "June 2026", status: "Submitted", syncStatus: "pending_cloud_sync" });
const rows = [current, october, september, august, refused, waiting];

const preview = (source: ReportLedgerRow): PreviewedReport => ({ reportId: source.report.id, period: source.report.period ?? source.report.date, metrics: METRICS, origins: {} });

describe("Review Report Form actions", () => {
  it("offer Print and Download PDF only once the report is Submitted or Consolidated", () => {
    expect(previewActions({ preview: preview(september), rows, openPeriod: "November 2026", openIsEditable: true, now: NOW })).toEqual({ kind: "export" });
    expect(previewActions({ preview: preview(august), rows, openPeriod: "August 2026", openIsEditable: false, now: NOW })).toEqual({ kind: "export" });
  });

  it("submit the month open in Create Reports from its own form", () => {
    expect(previewActions({ preview: preview(october), rows, openPeriod: "October 2026", openIsEditable: true, now: NOW })).toEqual({ kind: "submit-open" });
    // Create Reports' own Review button previews the open draft under the draft id.
    expect(previewActions({ preview: { ...preview(october), reportId: "TANAW-DRAFT" }, rows, openPeriod: "October 2026", openIsEditable: true, now: NOW })).toEqual({ kind: "submit-open" });
  });

  it("submit a Missing month from Reports History by opening that month first", () => {
    expect(previewActions({ preview: preview(october), rows, openPeriod: "November 2026", openIsEditable: true, now: NOW })).toEqual({ kind: "submit-month", period: "October 2026", blocker: null });
  });

  it("keep Submit Form disabled, with the reason, for a month that cannot be sent yet", () => {
    const open = previewActions({ preview: preview(current), rows, openPeriod: "September 2026", openIsEditable: false, now: NOW });
    expect(open).toEqual({ kind: "submit-month", period: "November 2026", blocker: "Submission opens on Dec 1, 2026 after the November 2026 reporting period closes." });
    expect(previewActions({ preview: preview(refused), rows, openPeriod: "November 2026", openIsEditable: true, now: NOW })).toMatchObject({ kind: "submit-month", blocker: REFUSED_REPORT_BLOCKER });
    expect(previewActions({ preview: preview(waiting), rows, openPeriod: "November 2026", openIsEditable: true, now: NOW })).toMatchObject({ kind: "submit-month", blocker: WAITING_REPORT_BLOCKER });
  });

  it("never offer to send again a report already sent, refused or waiting to upload", () => {
    expect(sentReportBlocker(refused.report)).toBe(REFUSED_REPORT_BLOCKER);
    expect(sentReportBlocker(waiting.report)).toBe(WAITING_REPORT_BLOCKER);
    // A reopened refused report gives its month back to the fix.
    expect(sentReportBlocker({ ...refused.report, reopenedAt: "2026-11-06T00:00:00Z" })).toBeNull();
    expect(sentReportBlocker(october.report)).toBeNull();
  });

  it("find the previewed report's row, or its month's draft", () => {
    expect(previewLedgerRow(rows, preview(september))).toBe(september);
    expect(previewLedgerRow(rows, { ...preview(october), reportId: "TANAW-DRAFT" })).toBe(october);
    expect(previewLedgerRow(rows, { ...preview(october), period: "March 2026" })).toBeNull();
  });
});
