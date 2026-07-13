import type { PeriodComplianceResource } from "@/shared/types";

export function BatchReportsStatusNotice({ compliance }: { compliance: PeriodComplianceResource | null }) {
  if (!compliance) {
    return <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">Compliance is unavailable until TANAW can read or freeze an authoritative obligation snapshot for the selected server-returned period.</p>;
  }
  if (compliance.summary.complete) {
    return <p className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900"><strong>Period compliance complete.</strong> All eligible obligations are accepted or consolidated and no eligibility remains unresolved.</p>;
  }
  return <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><strong>Period compliance incomplete.</strong> {compliance.summary.notSubmitted} not submitted, {compliance.summary.submitted} awaiting review, {compliance.summary.returned} returned, and {compliance.summary.unresolved} unresolved.</p>;
}
