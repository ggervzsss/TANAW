import type { ReportRecord } from "../../../types/enterprise";
import type { ReportingStatus } from "./report-status";

export type ReportLedgerRowKind = "current" | "pending" | "history";

export type ReportLedgerRow = {
  key: string;
  kind: ReportLedgerRowKind;
  report: ReportRecord;
  reportLabel: string;
  reportDescription: string;
  /** Pending, Submitted, Missing or Consolidated; see `reportingStatus`. */
  statusLabel: ReportingStatus;
};
