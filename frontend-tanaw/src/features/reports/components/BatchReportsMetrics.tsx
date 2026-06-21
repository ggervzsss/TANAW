import { Archive, Building2, CheckCircle2, FileText } from "lucide-react";
import { MetricCard } from "@/shared/components/cards";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import type { EnterpriseReportRow } from "../utils";

type BatchReportsMetricsProps = {
  reportEnterprises: ReportEnterprise[];
  readyReports: IntakeReport[];
  missingReports: EnterpriseReportRow[];
  archivedReports: IntakeReport[];
  isLoadingRegistry: boolean;
};

export function BatchReportsMetrics({ reportEnterprises, readyReports, missingReports, archivedReports, isLoadingRegistry }: BatchReportsMetricsProps) {
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <MetricCard label="Registered Enterprises" value={reportEnterprises.length} foot={isLoadingRegistry ? "Loading registry" : "Required to submit"} color="#065f46" icon={Building2} />
      <MetricCard label="Ready Reports" value={readyReports.length} foot="Available for consolidation" color="#10b981" icon={CheckCircle2} />
      <MetricCard label="Missing Submissions" value={missingReports.length} foot="Needs follow-up" color="#dc2626" footClassName="text-red-600" icon={FileText} />
      <MetricCard label="Archived Reports" value={archivedReports.length} foot="Past submissions" color="#2563eb" icon={Archive} />
    </section>
  );
}
