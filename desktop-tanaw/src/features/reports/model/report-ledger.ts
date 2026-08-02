import type { ReportRecord } from "../../../types/enterprise";

export type ReportLedgerRowKind = "current" | "pending" | "history";

export type ReportLedgerRow = {
  key: string;
  kind: ReportLedgerRowKind;
  report: ReportRecord;
  reportLabel: string;
  reportDescription: string;
  statusLabel: string;
};
