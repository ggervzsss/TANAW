import type { FinalReport, FinalReportArchivedFromStatus } from "@/shared/types";

export type FinalReportConfirmAction = "archive" | "finalize" | "restore" | "return" | null;

export function getRestoreStatus(report: FinalReport): FinalReportArchivedFromStatus {
  return report.archivedFromStatus ?? "Finalized";
}

export function finalReportConfirmCopy(action: Exclude<FinalReportConfirmAction, null>, report: FinalReport) {
  if (action === "finalize")
    return {
      title: "Finalize draft report?",
      eyebrow: "Final audit decision",
      message: "This will mark the consolidated draft as Finalized and ready for official DOT handoff. Further source-report corrections should be handled before this action.",
      tone: "emerald" as const,
      confirmLabel: "Finalize Report",
      pendingLabel: "Finalizing...",
    };
  if (action === "archive")
    return {
      title: "Archive final report?",
      eyebrow: "Archive report",
      message: "This will move the final report out of the active audit list while preserving its current workflow status for restoration.",
      tone: "amber" as const,
      confirmLabel: "Archive Report",
      pendingLabel: "Archiving...",
    };
  if (action === "restore")
    return {
      title: "Restore archived report?",
      eyebrow: "Restore report",
      message: `This will return the archived report to the active audit workflow as ${getRestoreStatus(report)}.`,
      tone: "emerald" as const,
      confirmLabel: "Restore Report",
      pendingLabel: "Restoring...",
    };
  return {
    title: "Return sources for revision?",
    eyebrow: "Source revision",
    message: "This will return the selected enterprise source reports for correction. Unselected source reports will remain ready for consolidation.",
    tone: "red" as const,
    confirmLabel: "Return for Revision",
    pendingLabel: "Returning...",
  };
}

export function finalReportConfirmDetails(action: Exclude<FinalReportConfirmAction, null>, report: FinalReport, returnRemarks: string, selectedSources: FinalReport["sources"]) {
  if (action === "return")
    return [
      { label: "Final Report", value: report.id },
      { label: "Period", value: report.period },
      { label: "Sources", value: selectedSources.length ? selectedSources.map((source) => `${source.code} (${source.enterprise})`).join(", ") : "No source reports selected." },
      { label: "Remarks", value: returnRemarks.trim() },
    ];
  return [
    { label: "Final Report", value: report.id },
    { label: "Period", value: report.period },
    { label: "Current Status", value: report.status },
    { label: "Next Status", value: action === "archive" ? "Archived" : action === "finalize" ? "Finalized" : getRestoreStatus(report) },
  ];
}
