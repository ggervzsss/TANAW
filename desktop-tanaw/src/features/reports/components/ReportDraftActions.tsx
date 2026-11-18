import { RotateCcw, Send } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftActionsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  metricsError: string | null;
  validationError: string | null;
  onSubmitPrompt: () => void;
};

export function ReportDraftActions({ activeReport, isReadOnly, metricsError, validationError, onSubmitPrompt }: ReportDraftActionsProps) {
  const isSubmitDisabled = Boolean(metricsError) || Boolean(validationError);

  if (isReadOnly) return null;

  return (
    <div>
      <button type="button" disabled={isSubmitDisabled} onClick={onSubmitPrompt} className="reports-button reports-primary report-submit-button">
        {activeReport?.status === "Returned for Revision" ? <RotateCcw size={14} /> : <Send size={14} />}
        {activeReport?.status === "Returned for Revision" ? "Resubmit Report" : "Submit Report"}
      </button>
    </div>
  );
}
