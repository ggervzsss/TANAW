import { RotateCcw, Send } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";
import { notifyWarning } from "../../toasts/services/toast-service";

type ReportDraftActionsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  validationError: string | null;
  onSubmitPrompt: () => void;
};

export function ReportDraftActions({ activeReport, isReadOnly, isPeriodChanging, metricsError, validationError, onSubmitPrompt }: ReportDraftActionsProps) {
  const warning = metricsError ?? validationError;

  if (isReadOnly) return null;

  return (
    <div>
      <button
        type="button"
        disabled={isPeriodChanging}
        aria-disabled={Boolean(warning) || undefined}
        onClick={() => {
          if (warning) notifyWarning(warning);
          else onSubmitPrompt();
        }}
        className="reports-button reports-primary report-submit-button"
      >
        {activeReport?.status === "Returned for Revision" ? <RotateCcw size={14} /> : <Send size={14} />}
        {activeReport?.status === "Returned for Revision" ? "Resubmit Report" : "Submit Report"}
      </button>
    </div>
  );
}
