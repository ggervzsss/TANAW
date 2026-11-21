import { Search } from "lucide-react";
import { useState } from "react";
import { Button, Input, Tabs } from "@/shared/ui-kit";
import { Panel } from "@/shared/components/panel";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { getBatchReportQueues, searchBatchReportRows } from "../model/batchReportQueues";
import { ReportStatusBadge } from "./ReportStatusBadge";

type BatchReportQueuesProps = {
  queues: ReturnType<typeof getBatchReportQueues>;
  query: string;
  isLoading: boolean;
  isError: boolean;
  onQueryChange: (query: string) => void;
  onOpenReport: (report: IntakeReport) => void;
  onFollowUp: (enterprise: ReportEnterprise) => void;
};

export function BatchReportQueues({ queues, query, isLoading, isError, onQueryChange, onOpenReport, onFollowUp }: BatchReportQueuesProps) {
  const [view, setView] = useState("attention");
  const count = (value: number) => (isLoading || isError ? undefined : value);
  const tabs = [
    { value: "attention", label: "Needs attention", count: count(queues.pending.length + queues.followUp.length) },
    { value: "ready", label: "Ready", count: count(queues.ready.length) },
    { value: "completed", label: "Completed", count: count(queues.completed.length) },
  ];
  const sections =
    view === "attention"
      ? [
          { title: "Pending review", rows: queues.pending, action: "Review report" },
          { title: "Missing or returned", rows: queues.followUp, action: "Follow up" },
        ]
      : [{ title: view === "ready" ? "Ready to consolidate" : "Consolidated submissions", rows: view === "ready" ? queues.ready : queues.completed, action: "View report" }];
  const visibleSections = sections.map((section) => ({ ...section, rows: searchBatchReportRows(section.rows, query) })).filter((section) => section.rows.length > 0);
  const emptyMessage = query.trim()
    ? "No submissions in this view match your search."
    : view === "attention"
      ? "No submissions need attention for this selection."
      : view === "ready"
        ? "Accepted submissions will appear here when they are ready to consolidate."
        : "No consolidated submissions for this selection.";

  return (
    <Panel className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3 sm:px-6">
        <Tabs ariaLabel="Submission status" idPrefix="batch-submissions" className="min-w-0 max-sm:w-full max-sm:flex-wrap" items={tabs} value={view} onChange={setView} />
        <Input
          type="search"
          aria-label="Search submissions"
          placeholder="Search establishment or report ID"
          leading={<Search size={16} aria-hidden="true" />}
          className="my-1 w-full sm:max-w-sm sm:flex-1"
          maxLength={200}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {tabs.map(({ value }) => (
        <div key={value} id={`batch-submissions-panel-${value}`} aria-labelledby={`batch-submissions-tab-${value}`} role="tabpanel" hidden={view !== value}>
          {view === value &&
            (isLoading || isError || visibleSections.length === 0 ? (
              <p role="status" className="px-4 py-5 text-sm text-(--tanaw-text-secondary) sm:px-6">
                {isLoading ? "Loading submissions…" : isError ? "Submission lists are unavailable." : emptyMessage}
              </p>
            ) : (
              visibleSections.map(({ title, rows, action }) => (
                <section key={title} aria-label={title}>
                  <h3 className="border-y border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-4 py-2.5 text-sm font-bold text-(--tanaw-text) sm:px-6">{title}</h3>
                  <ul className="divide-y divide-(--tanaw-border-soft)">
                    {rows.map(({ enterprise, currentReport, status }) => {
                      const needsFollowUp = action === "Follow up";
                      return (
                        <li key={enterprise.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold wrap-anywhere text-(--tanaw-text)">{enterprise.name}</p>
                            <p className="mt-0.5 text-xs wrap-anywhere text-(--tanaw-text-muted)">{[enterprise.barangay, currentReport?.code].filter(Boolean).join(" · ")}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            {needsFollowUp && <ReportStatusBadge status={status} />}
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`${action} for ${enterprise.name}`}
                              onClick={() => {
                                if (needsFollowUp) onFollowUp(enterprise);
                                else if (currentReport) onOpenReport(currentReport);
                              }}
                            >
                              {action}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            ))}
        </div>
      ))}
    </Panel>
  );
}
