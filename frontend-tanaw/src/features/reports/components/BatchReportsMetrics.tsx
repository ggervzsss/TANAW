import { Archive, Building2, CheckCircle2, FileText } from "lucide-react";
import { UnifiedMetricsHeader } from "@/shared/components/cards";
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
    <UnifiedMetricsHeader
      ariaLabel="Batch report summary"
      metrics={[
        {
          id: "registered",
          title: "Registered Enterprises",
          value: reportEnterprises.length,
          description: isLoadingRegistry ? "Loading registry" : "Required to submit",
          tone: "success",
          icon: Building2,
          isLoading: isLoadingRegistry,
        },
        {
          id: "ready",
          title: "Ready Reports",
          value: readyReports.length,
          description: "Available for consolidation",
          tone: "teal",
          icon: CheckCircle2,
          isLoading: isLoadingRegistry,
        },
        {
          id: "missing",
          title: "Missing Submissions",
          value: missingReports.length,
          description: "Needs follow-up",
          tone: "danger",
          icon: FileText,
          isLoading: isLoadingRegistry,
        },
        {
          id: "archived",
          title: "Archived Reports",
          value: archivedReports.length,
          description: "Past submissions",
          tone: "info",
          icon: Archive,
          isLoading: isLoadingRegistry,
        },
      ]}
    />
  );
}
