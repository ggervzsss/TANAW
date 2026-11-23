import { ChevronRight } from "lucide-react";
import { formatShortDate, reviewTone, submissionTone } from "@/features/reports/model/reportStatuses";
import { StatusPill, cn } from "@/shared/ui-kit";
import type { EnterpriseReportRow } from "../model/enterpriseReports";

type EnterpriseReportListProps = {
  rows: readonly EnterpriseReportRow[];
  openEnterpriseId: string | null;
  onOpen: (enterpriseId: string) => void;
};

/** The flat list of enterprises for a reporting month. Each row opens that enterprise's report details. */
export function EnterpriseReportList({ rows, openEnterpriseId, onOpen }: EnterpriseReportListProps) {
  return (
    <div className="mt-3.5 overflow-x-auto">
      <div className="min-w-225">
        <div
          className="tanaw-er-cols border-b border-(--tanaw-border-soft) px-3 py-3 text-[0.6875rem] font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase"
          aria-hidden="true"
        >
          <span>Enterprise</span>
          <span>Sent on</span>
          <span>Submission</span>
          <span>Staff review</span>
          <span>Reviewed by</span>
          <span />
        </div>
        <ul aria-label="Enterprise reports" className="m-0 list-none p-0">
          {rows.map(({ enterprise, entry }) => (
            <li key={enterprise.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={openEnterpriseId === enterprise.id}
                onClick={() => onOpen(enterprise.id)}
                className="tanaw-er-row tanaw-er-cols"
              >
                <span className="min-w-0">
                  <span className="block font-bold">{enterprise.name}</span>
                  <span className="mt-0.5 block text-[0.78125rem] text-(--tanaw-text-secondary) tabular-nums">
                    {enterprise.barangay} · {entry.reportCode ?? "No report yet"}
                  </span>
                </span>
                <span className={cn(!entry.sentAt && "text-(--tanaw-danger)")}>
                  <span className="sr-only">Sent on </span>
                  {entry.sentAt ? formatShortDate(entry.sentAt) : "Not sent"}
                </span>
                <span>
                  <StatusPill tone={submissionTone[entry.submission]}>
                    <span className="sr-only">Submission: </span>
                    {entry.submission}
                  </StatusPill>
                  {entry.submissionNote && <span className="mt-1 block text-xs text-(--tanaw-text-secondary)">{entry.submissionNote}</span>}
                </span>
                <span>
                  <StatusPill tone={reviewTone[entry.review]}>
                    <span className="sr-only">Staff review: </span>
                    {entry.review}
                  </StatusPill>
                </span>
                <span className={cn(!entry.reviewedBy && "text-(--tanaw-text-muted)")}>
                  <span className="sr-only">Reviewed by </span>
                  {entry.reviewedBy ?? "Not reviewed"}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="justify-self-end text-(--tanaw-text-muted)" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
