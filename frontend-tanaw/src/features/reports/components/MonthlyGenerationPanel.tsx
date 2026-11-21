import { FileSpreadsheet } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Button } from "@/shared/ui-kit";
import { Panel } from "@/shared/components/panel";
import type { SubmissionPeriod } from "../utils";

type MonthlyGenerationPanelProps = {
  children: ReactNode;
  period: SubmissionPeriod;
  coverage: string;
  enterpriseCount: number;
  readyCount: number;
  pendingCount: number;
  missingCount: number;
  returnedCount: number;
  completedCount: number;
  isLoading: boolean;
  isError: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
};

export function MonthlyGenerationPanel({
  children,
  period,
  coverage,
  enterpriseCount,
  readyCount,
  pendingCount,
  missingCount,
  returnedCount,
  completedCount,
  isLoading,
  isError,
  canGenerate,
  isGenerating,
  onGenerate,
}: MonthlyGenerationPanelProps) {
  const hasEstablishments = enterpriseCount > 0 && !isLoading && !isError;
  const isComplete = hasEstablishments && completedCount === enterpriseCount;
  const blockers = [
    pendingCount ? `${pendingCount} pending review` : "",
    missingCount ? `${missingCount} missing` : "",
    returnedCount ? `${returnedCount} returned` : "",
    completedCount ? `${completedCount} already consolidated` : "",
  ].filter(Boolean);

  let status = `${readyCount} of ${enterpriseCount} establishments ready.`;
  let detail = "";
  if (isError) status = "Submissions could not be loaded. Refresh to try again.";
  else if (isLoading) status = "Checking submissions…";
  else if (!hasEstablishments) status = "No establishments to consolidate for this selection.";
  else if (isComplete) status = "All submissions in this selection have been consolidated.";
  else if (canGenerate) {
    detail = status;
    status = "Ready to generate";
  }
  else if (blockers.length) detail = `${blockers.join(" · ")}. Generation requires all submissions in the selected coverage to be ready.`;

  return (
    <Panel className="overflow-hidden">
      <section aria-labelledby="monthly-generation-title">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-(--tanaw-border-soft) px-4 py-3 sm:px-6">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 bg-(--tanaw-surface-inset) px-4 py-5 sm:px-6">
          <div className="min-w-0 sm:flex-1">
            <h2 id="monthly-generation-title" className="font-display text-xl font-bold text-(--tanaw-text)">
              Monthly report
            </h2>
            <p className="mt-1 text-sm wrap-anywhere text-(--tanaw-text-secondary)">
              {period.month} {period.year} · {coverage}
            </p>
            <div id="monthly-generation-status" role="status" className="mt-3 space-y-0.5 text-sm">
              <p className="font-semibold text-(--tanaw-text)">{status}</p>
              {detail && <p className="leading-relaxed text-(--tanaw-text-secondary)">{detail}</p>}
            </div>
          </div>
          {isComplete ? (
            <Link
              to={{ pathname: routes.staff.generatedReports, search: new URLSearchParams(period).toString() }}
              className="rounded-tanaw-md inline-flex min-h-10.5 items-center justify-center gap-2 border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-4 text-sm font-bold text-(--tanaw-text) hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) max-sm:w-full"
            >
              <FileSpreadsheet size={16} aria-hidden="true" /> View generated reports
            </Link>
          ) : (
            <Button
              size="lg"
              aria-describedby="monthly-generation-status"
              className="max-sm:w-full"
              leadingIcon={<FileSpreadsheet size={18} aria-hidden="true" />}
              disabled={!canGenerate}
              loading={isGenerating}
              onClick={onGenerate}
            >
              {isGenerating ? "Generating…" : "Generate monthly report"}
            </Button>
          )}
        </div>
      </section>
    </Panel>
  );
}
