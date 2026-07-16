import { AlertTriangle, CheckCircle2, ClipboardList, FileCheck2 } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { PeriodComplianceResource } from "@/shared/types";

export function BatchReportsMetrics({ compliance, loadedReportCount }: { compliance: PeriodComplianceResource | null; loadedReportCount: number }) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard
        label="Expected Enterprises"
        value={compliance?.summary.totalFrozen ?? "—"}
        foot={compliance ? "For this reporting period" : "Preparing period"}
        color="#065f46"
        icon={ClipboardList}
      />
      <MetricCard label="Not Submitted" value={compliance?.summary.notSubmitted ?? "—"} foot="Waiting for a report" color="#dc2626" icon={AlertTriangle} />
      <MetricCard label="Accepted" value={compliance?.summary.accepted ?? "—"} foot="Ready for a final report" color="#059669" icon={CheckCircle2} />
      <MetricCard label="Reports Received" value={loadedReportCount} foot="Submitted for this period" color="#2563eb" icon={FileCheck2} />
    </section>
  );
}
