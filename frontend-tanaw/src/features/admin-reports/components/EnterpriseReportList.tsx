import { ChevronRight } from "lucide-react";
import { formatShortDate, reviewTone, submissionTone } from "@/features/reports/model/reportStatuses";
import { StatusPill, cn } from "@/shared/ui-kit";
import type { EnterpriseReportRow } from "../model/enterpriseReports";

type EnterpriseReportListProps = {
  rows: readonly EnterpriseReportRow[];
  openEnterpriseId: string | null;
  onOpen: (enterpriseId: string) => void;
};

/**
 * The flat list of enterprises for a reporting month. Each row opens that enterprise's report details.
 * On phones each row stacks (admin-reports.css): the name and chevron, the submission and review pills,
 * then when it was sent and who reviewed it, with no sideways scroll.
 */
export function EnterpriseReportList({ rows, openEnterpriseId, onOpen }: EnterpriseReportListProps) {
  return (
    <div className="mt-3.5 overflow-x-auto max-md:mt-2 max-[60rem]:overflow-x-visible">
      <div className="min-[60rem]:min-w-225">
        <div className="tanaw-er-cols tanaw-er-head border-b border-(--tanaw-border-soft) px-3 py-3 max-md:hidden" aria-hidden="true">
          <span>Enterprise</span>
          <span>Sent on</span>
          <span>Submission</span>
          <span>Staff review</span>
          <span>Reviewed by</span>
          <span />
        </div>
        <ul aria-label="Enterprise reports" className="tanaw-er-fade m-0 list-none p-0">
          {rows.map(({ enterprise, entry }) => (
            <li key={enterprise.id} className="tanaw-er-item">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={openEnterpriseId === enterprise.id}
                onClick={() => onOpen(enterprise.id)}
                className="tanaw-er-row tanaw-er-cols"
              >
                <span className="tanaw-er-cell--name min-w-0">
                  <span className="tanaw-er-row__name block font-semibold">{enterprise.name}</span>
                  <span className="mt-0.5 block text-[13px] text-(--tanaw-text-secondary) tabular-nums">
                    {enterprise.barangay} · {entry.reportCode ?? "No report yet"}
                  </span>
                </span>
                <span className={cn("tanaw-er-cell--sent", !entry.sentAt && "text-(--tanaw-danger)")}>
                  <span className={cn("sr-only", entry.sentAt && "max-md:not-sr-only max-md:text-(--tanaw-text-muted)")}>Sent on </span>
                  {entry.sentAt ? formatShortDate(entry.sentAt) : "Not sent"}
                </span>
                <span className="tanaw-er-cell--submission">
                  <StatusPill tone={submissionTone[entry.submission]}>
                    <span className="sr-only">Submission: </span>
                    {entry.submission}
                  </StatusPill>
                  {entry.submissionNote && <span className="mt-1 block text-xs text-(--tanaw-text-secondary)">{entry.submissionNote}</span>}
                </span>
                <span className="tanaw-er-cell--review">
                  <StatusPill tone={reviewTone[entry.review]}>
                    <span className="sr-only">Staff review: </span>
                    {entry.review}
                  </StatusPill>
                </span>
                <span className={cn("tanaw-er-cell--reviewer", !entry.reviewedBy && "text-(--tanaw-text-muted)")} data-empty={entry.reviewedBy ? undefined : true}>
                  <span className={cn("sr-only", entry.reviewedBy && "max-md:not-sr-only max-md:text-(--tanaw-text-muted)")}>Reviewed by </span>
                  {entry.reviewedBy ?? "Not reviewed"}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="tanaw-er-row__chevron justify-self-end" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
