import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import type { StaffAnalyticsViewModel } from "../hooks";
import type { BarangayComplianceRow } from "../model";

export function CompliancePanel({ analytics }: { analytics: StaffAnalyticsViewModel }) {
  return (
    <section className="tanaw-dashboard-panel flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Compliance Status</h3>
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label={`${analytics.submittedCount} complete reports and ${analytics.pendingCount} pending reports`}>
          <CountBadge label="Complete" count={analytics.submittedCount} tone="complete" />
          <CountBadge label="Pending" count={analytics.pendingCount} tone="pending" />
        </div>
      </div>
      <div className="max-h-75 space-y-4 overflow-y-auto pr-1">
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

function CountBadge({ label, count, tone }: { label: string; count: number; tone: "complete" | "pending" }) {
  const classes =
    tone === "complete"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide uppercase ${classes}`}>
      {label} <strong className="font-mono text-xs">{count}</strong>
    </span>
  );
}

function BarangayComplianceItem({ row }: { row: BarangayComplianceRow }) {
  const complete = row.pending === 0;
  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${complete ? "border-emerald-100 bg-emerald-50 dark:border-emerald-300/20 dark:bg-emerald-500/10" : "border-amber-100 bg-amber-50 dark:border-amber-300/20 dark:bg-amber-400/10"}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold tracking-wide uppercase ${complete ? "text-emerald-800" : "text-amber-800"}`}>{row.barangay}</span>
        <span className="shrink-0 font-mono text-[10px] text-gray-500">{row.total} total</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ComplianceCount label="Complete" count={row.complete} tone="complete" />
        <ComplianceCount label="Pending" count={row.pending} tone="pending" />
      </div>
      <p className={`mt-2 text-xs leading-normal ${complete ? "text-emerald-700" : "text-amber-700"}`}>
        {complete ? "All registered enterprises submitted for this period." : `${row.pending} enterprise${row.pending === 1 ? "" : "s"} still pending for this period.`}
      </p>
    </div>
  );
}

function ComplianceCount({ label, count, tone }: { label: string; count: number; tone: "complete" | "pending" }) {
  const classes = tone === "complete" ? "border-emerald-100 dark:border-emerald-300/20" : "border-amber-100 dark:border-amber-300/20";
  const text = tone === "complete" ? "text-emerald-700" : "text-amber-700";
  return (
    <div className={`tanaw-dashboard-inset rounded-lg border bg-white/60 px-2 py-1.5 ${classes}`}>
      <p className={`text-[10px] font-bold tracking-wide uppercase ${text}`}>{label}</p>
      <p className={`font-mono text-lg font-black ${tone === "complete" ? "text-emerald-800" : "text-amber-800"}`}>{count}</p>
    </div>
  );
}
