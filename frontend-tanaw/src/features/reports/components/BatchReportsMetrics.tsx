import { AlertTriangle, CheckCircle2, ClipboardList, FileSearch2 } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { PeriodComplianceResource } from "@/shared/types";

export function BatchReportsMetrics({ compliance }: { compliance: PeriodComplianceResource | null }) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard
        label="Expected Reports"
        value={compliance?.summary.eligibleExpected ?? "—"}
        foot={compliance ? "For this reporting month" : "Preparing month"}
        color="#065f46"
        icon={ClipboardList}
      />
      <MetricCard label="For Review" value={compliance?.summary.submitted ?? "—"} foot="Waiting for staff review" color="#d97706" icon={FileSearch2} />
      <MetricCard label="Needs Changes" value={compliance?.summary.returned ?? "—"} foot="Returned to enterprises" color="#dc2626" icon={AlertTriangle} />
      <MetricCard
        label="Accepted"
        value={compliance ? compliance.summary.accepted + compliance.summary.consolidated : "—"}
        foot="Ready or included in a final report"
        color="#059669"
        icon={CheckCircle2}
      />
    </section>
  );
}
