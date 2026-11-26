import { Send } from "lucide-react";
import { notifyWarning } from "../../toasts/services/toast-service";

type ReportDraftActionsProps = {
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  validationError: string | null;
  onSubmitPrompt: () => void;
};

export function ReportDraftActions({ isReadOnly, isPeriodChanging, metricsError, validationError, onSubmitPrompt }: ReportDraftActionsProps) {
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
        <Send size={14} />
        Submit Report
      </button>
    </div>
  );
}
