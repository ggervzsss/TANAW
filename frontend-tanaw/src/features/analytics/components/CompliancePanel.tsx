import { CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import type { StaffAnalyticsViewModel } from "../hooks";
import { getCompliancePercentage, type BarangayComplianceRow } from "../model";

export function CompliancePanel({ analytics }: { analytics: StaffAnalyticsViewModel }) {
  return (
    <section className="tanaw-dashboard-panel tanaw-compliance-panel flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-gray-200 bg-white shadow-sm">
      <header className="tanaw-dashboard-card-header border-b px-5 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="tanaw-compliance-panel__icon grid h-10 w-10 shrink-0 place-items-center rounded-xl" aria-hidden="true">
            <ClipboardCheck size={19} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Compliance Status</h3>
            <p className="tanaw-dashboard-card-copy mt-1 text-xs leading-relaxed">Submission progress by barangay</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2" aria-label={`${analytics.submittedCount} complete reports and ${analytics.pendingCount} pending reports`}>
          <CountSummary label="Complete" count={analytics.submittedCount} tone="complete" />
          <CountSummary label="Pending" count={analytics.pendingCount} tone="pending" />
        </div>
      </header>

      <div
        className="tanaw-dashboard-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-(--tanaw-focus-ring)"
        tabIndex={0}
        aria-label="Barangay compliance list"
      >
        {analytics.complianceRows.map((row) => (
          <BarangayComplianceItem key={row.barangay} row={row} />
        ))}
        {analytics.enterpriseLoading && <EmptyState icon={ClipboardCheck} title="Loading registry" description="Fetching registered enterprise accounts." minHeightClassName="min-h-45" />}
        {!analytics.enterpriseLoading && analytics.reportsLoading && (
          <EmptyState icon={ClipboardCheck} title="Loading submissions" description="Fetching the latest report intake records." minHeightClassName="min-h-45" />
        )}
        {!analytics.enterpriseLoading && analytics.complianceRows.length === 0 && (
          <EmptyState icon={ClipboardCheck} title="No registered enterprises" description="Compliance status will appear once enterprise accounts are registered." minHeightClassName="min-h-45" />
        )}
      </div>
    </section>
  );
}

function CountSummary({ label, count, tone }: { label: string; count: number; tone: "complete" | "pending" }) {
  const Icon = tone === "complete" ? CheckCircle2 : Clock3;
  return (
    <div className="tanaw-compliance-summary flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5" data-tone={tone}>
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 text-[10px] font-bold tracking-wider uppercase">{label}</span>
      <strong className="ml-auto font-mono text-sm tabular-nums">{count}</strong>
    </div>
  );
}

function BarangayComplianceItem({ row }: { row: BarangayComplianceRow }) {
  const percentage = getCompliancePercentage(row.complete, row.total);
  const state = row.total === 0 ? "empty" : row.pending === 0 ? "complete" : "pending";
  const message =
    state === "empty"
      ? "No registered enterprises for this barangay."
      : state === "complete"
        ? "All registered enterprises submitted for this period."
        : `${row.pending} enterprise${row.pending === 1 ? "" : "s"} still pending for this period.`;

  return (
    <article className="tanaw-compliance-item rounded-2xl border p-4" data-state={state}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="min-w-0 truncate text-xs font-bold tracking-[0.04em] text-(--tanaw-text) uppercase" title={row.barangay}>
          {row.barangay}
        </h4>
        <span className="shrink-0 font-mono text-[10px] font-semibold text-(--tanaw-muted-text) tabular-nums">{row.total} total</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-(--tanaw-secondary-text)">
          <strong className="font-semibold text-(--tanaw-text)">
            {row.complete} of {row.total}
          </strong>{" "}
          reports complete
        </span>
        <span className="font-mono font-bold text-(--tanaw-text) tabular-nums">{percentage}%</span>
      </div>
      <div
        className="tanaw-compliance-progress mt-2 h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`${row.barangay} report completion`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span className="block h-full rounded-full" style={{ width: `${percentage}%` }} />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
        <div className="flex items-center gap-2">
          <dt className="text-(--tanaw-secondary-text)">Complete</dt>
          <dd className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-300">{row.complete}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-(--tanaw-secondary-text)">Pending</dt>
          <dd className="font-mono font-bold text-amber-700 tabular-nums dark:text-amber-300">{row.pending}</dd>
        </div>
      </dl>
      <p className="tanaw-compliance-item__message mt-3 text-[11px] leading-relaxed font-medium">{message}</p>
    </article>
  );
}
