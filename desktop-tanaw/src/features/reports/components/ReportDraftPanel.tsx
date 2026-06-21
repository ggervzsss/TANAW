import React from "react";
import { Card } from "../../../components/Card";
import type { DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { DemographicsBreakdown } from "./DemographicsBreakdown";
import { ReportAuditTrail } from "./ReportAuditTrail";
import { ReportDraftActions } from "./ReportDraftActions";
import { ReportDraftAlerts } from "./ReportDraftAlerts";
import { ReportDraftHeader } from "./ReportDraftHeader";
import { ReportingPeriodSelect } from "./ReportingPeriodSelect";
import { SupplementaryNotes } from "./SupplementaryNotes";
import { SystemLockedMetrics } from "./SystemLockedMetrics";

type ReportDraftPanelProps = {
  activeReport: ReportRecord | null;
  activeReportId: string | null;
  demo: DemoBreakdown;
  isError: boolean;
  isReadOnly: boolean;
  metricsError: string | null;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  prevMetrics: Metrics | null;
  uniqueTrend: number;
  validationError: string | null;
  onPreview: () => void;
  onSubmitPrompt: () => void;
  setDemo: React.Dispatch<React.SetStateAction<DemoBreakdown>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  setPeriod: React.Dispatch<React.SetStateAction<SystemLogPeriod>>;
};

export function ReportDraftPanel({
  activeReport,
  activeReportId,
  demo,
  isError,
  isReadOnly,
  metricsError,
  metrics,
  notes,
  period,
  prevMetrics,
  uniqueTrend,
  validationError,
  onPreview,
  onSubmitPrompt,
  setDemo,
  setNotes,
  setPeriod,
}: ReportDraftPanelProps) {
  return (
    <Card
      className={`h-fit rounded-sm border-t-4 p-6 shadow-md transition-colors lg:col-span-1 ${isReadOnly ? "border-t-gray-400" : activeReport?.status === "Returned for Revision" ? "border-t-[#ffd200]" : "border-t-[#065f46]"}`}
    >
      <ReportDraftHeader activeReport={activeReport} activeReportId={activeReportId} isReadOnly={isReadOnly} />
      <ReportDraftAlerts activeReport={activeReport} isError={isError} isReadOnly={isReadOnly} metricsError={metricsError} validationError={validationError} />

      <div className={`space-y-5 ${isReadOnly ? "opacity-80" : ""}`}>
        <ReportingPeriodSelect isReadOnly={isReadOnly} period={period} setPeriod={setPeriod} />
        <SystemLockedMetrics metrics={metrics} prevMetrics={prevMetrics} uniqueTrend={uniqueTrend} />
        <DemographicsBreakdown demo={demo} isReadOnly={isReadOnly} setDemo={setDemo} />
        <SupplementaryNotes isReadOnly={isReadOnly} notes={notes} setNotes={setNotes} />
        <ReportDraftActions activeReport={activeReport} isError={isError} isReadOnly={isReadOnly} metricsError={metricsError} validationError={validationError} onPreview={onPreview} onSubmitPrompt={onSubmitPrompt} />
        <ReportAuditTrail activeReport={activeReport} />
      </div>
    </Card>
  );
}
