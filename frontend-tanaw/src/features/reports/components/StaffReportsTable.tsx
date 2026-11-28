import { BellRing, Check, ChevronRight } from "lucide-react";
import { Button, StatusPill, openRowFromClick } from "@/shared/ui-kit";
import { reviewTone, submissionTone } from "../model/reportStatuses";
import { reminderButton, type StaffReportRow } from "../model/staffReports";

type StaffReportsTableProps = {
  rows: readonly StaffReportRow[];
  emptyMessage: string;
  remindingId: string | null;
  wasReminded: (row: StaffReportRow) => boolean;
  onOpen: (row: StaffReportRow) => void;
  onRemind: (row: StaffReportRow) => void;
};

/**
 * One row per enterprise for the month. A row with a report opens it when clicked anywhere; a row
 * without one offers its reminder.
 */
export function StaffReportsTable({ rows, emptyMessage, remindingId, wasReminded, onOpen, onRemind }: StaffReportsTableProps) {
  return (
    <>
      <div className="tanaw-staff-rise overflow-x-auto">
        <table className="tanaw-staff-table tanaw-staff-table--stack">
          <thead>
            <tr>
              <th scope="col">Enterprise</th>
              <th scope="col" className="tanaw-hide-sm">
                Report ID
              </th>
              <th scope="col" className="tanaw-hide-sm">
                Sent
              </th>
              <th scope="col">Submission</th>
              <th scope="col">Staff review</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const opens = row.action === "review" || row.action === "view";
              return (
                <tr key={row.key} data-enterprise={row.enterpriseId} data-remind={row.remind || undefined} onClick={opens ? openRowFromClick : undefined} className={opens ? "tanaw-row-link" : undefined}>
                  <th scope="row" data-cell="name">
                    {opens ? (
                      <button
                        type="button"
                        data-row-primary
                        aria-label={`${row.action === "review" ? "Review" : "View"} the report from ${row.name}`}
                        onClick={() => onOpen(row)}
                        className="block font-semibold text-(--tanaw-text)"
                      >
                        {row.name}
                      </button>
                    ) : (
                      <span className="block font-semibold text-(--tanaw-text)">{row.name}</span>
                    )}
                    {row.barangay && <span className="mt-0.5 block text-[0.8125rem] font-normal text-(--tanaw-text-muted)">{row.barangay}</span>}
                  </th>
                  <td data-cell="meta" data-empty={row.report ? undefined : ""} className="tanaw-hide-sm text-(--tanaw-text-secondary) tabular-nums">
                    {row.report?.code ?? "No report yet"}
                  </td>
                  <td data-cell="meta" data-label={row.sent ? "Sent" : undefined} className="tanaw-hide-sm">
                    <span className="block">{row.sent ?? "Not sent"}</span>
                    {row.note && (
                      <span className={row.submission === "Missing" ? "block text-[0.8125rem] text-(--tanaw-st-missing)" : "block text-[0.8125rem] text-(--tanaw-st-pending)"}>{row.note}</span>
                    )}
                  </td>
                  <td data-cell="pill">
                    <StatusPill tone={submissionTone[row.submission]}>{row.submission}</StatusPill>
                  </td>
                  <td data-cell="pill">
                    <StatusPill tone={reviewTone[row.review]}>{row.review}</StatusPill>
                  </td>
                  <td data-cell="action">
                    {row.remind ? (
                      <ReminderButton row={row} reminding={remindingId === row.enterpriseId} reminded={wasReminded(row)} onRemind={onRemind} />
                    ) : (
                      opens && <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron ml-auto" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p role="status" className="mt-3.5 text-sm text-(--tanaw-text-secondary)">
          {emptyMessage}
        </p>
      )}
    </>
  );
}

function ReminderButton({ row, reminding, reminded, onRemind }: { row: StaffReportRow; reminding: boolean; reminded: boolean; onRemind: (row: StaffReportRow) => void }) {
  const button = reminderButton(row.name, reminded);
  // A missing report is the one row that needs Staff to act: a dark red Remind with a bell that
  // rings on hover (reports.css). Once sent it settles into a quiet "Reminded" with a check.
  if (reminded) {
    return (
      <Button size="sm" variant="secondary" aria-label={button.ariaLabel} disabled className="tanaw-remind-button tanaw-remind-button--sent" leadingIcon={<Check size={14} strokeWidth={2.4} aria-hidden="true" />}>
        {button.label}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="destructive" aria-label={button.ariaLabel} loading={reminding} onClick={() => onRemind(row)} className="tanaw-remind-button" leadingIcon={<BellRing size={14} strokeWidth={2.2} aria-hidden="true" />}>
      {button.label}
    </Button>
  );
}
