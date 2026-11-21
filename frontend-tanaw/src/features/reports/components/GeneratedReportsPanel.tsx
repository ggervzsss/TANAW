import { FileSpreadsheet } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui-kit";
import { Panel } from "@/shared/components/panel";
import type { FinalReport } from "@/shared/types";
import { ReportStatusBadge } from "./ReportStatusBadge";

type GeneratedReportsPanelProps = {
  reports: readonly FinalReport[];
  isLoading: boolean;
  isError: boolean;
  isFiltered: boolean;
  onOpenReport: (reportId: string) => void;
  onOpenAnnualReport: () => void;
  children: ReactNode;
};

export function GeneratedReportsPanel({ reports, isLoading, isError, isFiltered, onOpenReport, onOpenAnnualReport, children }: GeneratedReportsPanelProps) {
  return (
    <Panel className="overflow-hidden">
      <section aria-labelledby="monthly-reports-title">
        <header className="space-y-4 border-b border-(--tanaw-border-soft) px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="monthly-reports-title" className="font-display text-lg font-bold text-(--tanaw-text)">
              Monthly reports (VAR 2M)
            </h2>
            <Button variant="secondary" leadingIcon={<FileSpreadsheet size={16} aria-hidden="true" />} onClick={onOpenAnnualReport} disabled={isLoading || isError}>
              View annual report
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        </header>
        {reports.length > 0 ? (
          <ul className="divide-y divide-(--tanaw-border-soft)">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-(--tanaw-text)">{report.period}</p>
                  <p className="mt-1 text-xs wrap-anywhere text-(--tanaw-text-muted)">{report.id}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-xs text-(--tanaw-text-muted)">
                    {report.enterpriseCount} {report.enterpriseCount === 1 ? "establishment" : "establishments"}
                  </p>
                  <ReportStatusBadge status={report.status} />
                  <Button size="sm" variant="secondary" aria-label={`View monthly report ${report.id}`} onClick={() => onOpenReport(report.id)}>
                    View report
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-(--tanaw-text-secondary) sm:px-6" role={isError ? "alert" : "status"}>
            {isError
              ? "Generated reports could not be loaded. Refresh to try again."
              : isLoading
                ? "Loading generated reports…"
                : isFiltered
                  ? "No monthly reports match your search and filters."
                  : "Monthly reports will appear here after staff generate them in Batch Reports."}
          </p>
        )}
      </section>
    </Panel>
  );
}
