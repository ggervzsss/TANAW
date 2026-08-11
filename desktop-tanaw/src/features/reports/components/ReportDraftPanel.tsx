import React from "react";
import { Card } from "../../../components/Card";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DemographicsBreakdown } from "./DemographicsBreakdown";
import { ReportAuditTrail } from "./ReportAuditTrail";
import { ReportDraftActions } from "./ReportDraftActions";
import { ReportDraftAlerts } from "./ReportDraftAlerts";
import { ReportDraftHeader } from "./ReportDraftHeader";
import { ReportingPeriodField } from "./ReportingPeriodField";
import { SupplementaryNotes } from "./SupplementaryNotes";
import { SystemLockedMetrics } from "./SystemLockedMetrics";

type ReportDraftPanelProps = {
  activeReport: ReportRecord | null;
  activeReportId: string | null;
  demo: DemoBreakdown;
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  previousDemo?: DemoBreakdown | null;
  validationError: string | null;
  onSubmitPrompt: () => void;
  setDemo: React.Dispatch<React.SetStateAction<DemoBreakdown>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
};

export function ReportDraftPanel({
  activeReport,
  activeReportId,
  demo,
  isReadOnly,
  isPeriodChanging,
  metricsError,
  metrics,
  notes,
  period,
  previousDemo = null,
  validationError,
  onSubmitPrompt,
  setDemo,
  setNotes,
}: ReportDraftPanelProps) {
  const isCurrentReport = !activeReport;

  return (
    <Card
      className={`relative h-fit overflow-hidden rounded-[22px] border p-5 shadow-[0_18px_42px_rgba(15,23,42,0.08)] transition-colors dark:shadow-[0_20px_48px_rgba(2,8,18,0.3)] ${isReadOnly ? "border-gray-300 border-t-gray-400" : activeReport?.status === "Returned for Revision" ? "border-amber-200 border-t-[#ffd200]" : "border-emerald-800/18 border-t-[#065f46]"} border-t-[3px]`}
    >
      <ReportDraftHeader activeReport={activeReport} activeReportId={activeReportId} isReadOnly={isReadOnly} />
      <ReportDraftAlerts activeReport={activeReport} />

      <div className={`space-y-5 ${isReadOnly ? "opacity-80" : ""}`}>
        <ReportingPeriodField
          description={isCurrentReport ? "Use Report Submissions to switch between current and pending reporting periods." : "This is the period saved with the selected report."}
          isLoading={isPeriodChanging}
          label={isCurrentReport ? "Current Reporting Period" : "Report Period"}
          period={period}
        />
        <SystemLockedMetrics demo={demo} metrics={metrics} />
        <DemographicsBreakdown demo={demo} isReadOnly={isReadOnly} previousDemo={previousDemo} setDemo={setDemo} uniqueCap={metrics.unique} />
        <SupplementaryNotes isReadOnly={isReadOnly} notes={notes} setNotes={setNotes} />
        <ReportDraftActions activeReport={activeReport} isReadOnly={isReadOnly} metricsError={metricsError} validationError={validationError} onSubmitPrompt={onSubmitPrompt} />
        <ReportAuditTrail activeReport={activeReport} />
      </div>
    </Card>
  );
}
