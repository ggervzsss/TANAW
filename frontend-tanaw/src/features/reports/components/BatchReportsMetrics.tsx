import { AlertTriangle, CheckCircle2, ClipboardList, FileCheck2 } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { PeriodComplianceResource } from "@/shared/types";

export function BatchReportsMetrics({ compliance, loadedReportCount }: { compliance: PeriodComplianceResource | null; loadedReportCount: number }) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard label="Frozen Obligations" value={compliance?.summary.totalFrozen ?? "—"} foot={compliance ? "Authoritative period snapshot" : "Select a server period"} color="#065f46" icon={ClipboardList} />
      <MetricCard label="Not Submitted" value={compliance?.summary.notSubmitted ?? "—"} foot="Derived from obligations" color="#dc2626" icon={AlertTriangle} />
      <MetricCard label="Accepted" value={compliance?.summary.accepted ?? "—"} foot="Eligible for finalization" color="#059669" icon={CheckCircle2} />
      <MetricCard label="Loaded Official Reports" value={loadedReportCount} foot="All keyset pages, no row cap" color="#2563eb" icon={FileCheck2} />
    </section>
  );
}
