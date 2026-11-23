import type { ReactNode } from "react";
import { progressBarLabel, type StaffReportsProgress } from "../model/staffReports";

type ReportsProgressStripProps = {
  id: string;
  progress: StaffReportsProgress;
  status: { line: string; detail: ReactNode };
};

const SEGMENTS = [
  { key: "consolidated", label: "Consolidated", color: "var(--tanaw-st-consolidated)" },
  { key: "reviewing", label: "Reviewing", color: "var(--tanaw-st-reviewing)" },
  { key: "waiting", label: "Waiting", color: "var(--tanaw-st-waiting-fill)" },
] as const;

/** How far the month's received reports are through staff review, as a status line and a segmented bar. */
export function ReportsProgressStrip({ id, progress, status }: ReportsProgressStripProps) {
  const segments = SEGMENTS.map((segment) => ({ ...segment, size: progress[segment.key] })).filter((segment) => segment.size > 0);

  return (
    <section aria-label="Review progress" className="border-y border-(--tanaw-border-soft) py-3.5">
      <p id={id} role="status" className="text-sm text-(--tanaw-text)">
        <strong className="font-semibold">{status.line}</strong> {status.detail && <span className="text-(--tanaw-text-secondary)">{status.detail}</span>}
      </p>
      <div role="img" aria-label={progressBarLabel(progress)} className="mt-2 flex h-2 gap-0.75">
        {segments.length ? (
          segments.map((segment) => <span key={segment.key} className="rounded-xs" style={{ flex: segment.size, background: segment.color }} />)
        ) : (
          <span className="flex-1 rounded-xs bg-(--tanaw-border-soft)" />
        )}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-(--tanaw-text-secondary)">
        {SEGMENTS.map((segment) => (
          <span key={segment.key} className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: segment.color }} />
            {segment.label}
          </span>
        ))}
      </p>
    </section>
  );
}
