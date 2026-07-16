import type { PeriodComplianceResource } from "@/shared/types";

export function BatchReportsStatusNotice({ compliance }: { compliance: PeriodComplianceResource | null }) {
  if (!compliance) {
    return <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">Submission tracking is being prepared for this period.</p>;
  }
  if (compliance.summary.complete) {
    return (
      <p className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
        <strong>All expected reports are complete.</strong>
      </p>
    );
  }
  return (
    <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
      <strong>Reports still pending.</strong> {compliance.summary.notSubmitted} not submitted, {compliance.summary.submitted} awaiting review, {compliance.summary.returned} returned, and{" "}
      {compliance.summary.unresolved} need attention.
    </p>
  );
}
