import { Button, StatusPill } from "@/shared/ui-kit";
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

/** One row per enterprise for the month, with the one action that row needs. */
export function StaffReportsTable({ rows, emptyMessage, remindingId, wasReminded, onOpen, onRemind }: StaffReportsTableProps) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="tanaw-staff-table">
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
            {rows.map((row) => (
              <tr key={row.key} data-enterprise={row.enterpriseId}>
                <th scope="row">
                  <span className="block font-semibold text-(--tanaw-text)">{row.name}</span>
                  {row.barangay && <span className="mt-0.5 block text-[0.8125rem] font-normal text-(--tanaw-text-muted)">{row.barangay}</span>}
                </th>
                <td className="tanaw-hide-sm text-(--tanaw-text-secondary) tabular-nums">{row.report?.code ?? "No report yet"}</td>
                <td className="tanaw-hide-sm">
                  <span className="block">{row.sent ?? "Not sent"}</span>
                  {row.note && <span className={row.submission === "Missing" ? "block text-[0.8125rem] text-(--tanaw-st-missing)" : "block text-[0.8125rem] text-(--tanaw-st-pending)"}>{row.note}</span>}
                </td>
                <td>
                  <StatusPill tone={submissionTone[row.submission]}>{row.submission}</StatusPill>
                </td>
                <td>
                  <StatusPill tone={reviewTone[row.review]}>{row.review}</StatusPill>
                </td>
                <td>
                  <RowAction row={row} reminding={remindingId === row.enterpriseId} reminded={wasReminded(row)} onOpen={onOpen} onRemind={onRemind} />
                </td>
              </tr>
            ))}
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

function RowAction({ row, reminding, reminded, onOpen, onRemind }: { row: StaffReportRow; reminding: boolean; reminded: boolean; onOpen: (row: StaffReportRow) => void; onRemind: (row: StaffReportRow) => void }) {
  if (row.action === "review") {
    return (
      <Button size="sm" aria-label={`Review the report from ${row.name}`} onClick={() => onOpen(row)}>
        Review
      </Button>
    );
  }
  if (row.action === "view") {
    return (
      <Button size="sm" variant="secondary" aria-label={`View the report from ${row.name}`} onClick={() => onOpen(row)}>
        View
      </Button>
    );
  }
  const button = reminderButton(row.name, reminded);
  return (
    <Button size="sm" variant="secondary" aria-label={button.ariaLabel} loading={reminding} disabled={reminded} onClick={() => onRemind(row)}>
      {button.label}
    </Button>
  );
}
