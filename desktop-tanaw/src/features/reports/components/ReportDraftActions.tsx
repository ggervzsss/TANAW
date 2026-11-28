import { useId, useState } from "react";
import { CircleAlert, LoaderCircle, Send } from "lucide-react";

type ReportDraftActionsProps = {
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  validationError: string | null;
  /** True while this month's counts load; the note then says so quietly. */
  isLoadingCounts?: boolean;
  /** Shows the day whose origins need fixing, when that is what blocks the report. */
  fixDay?: { label: string; onShow: () => void } | null;
  onSubmitPrompt: () => void;
  /** The button text: Submit Report in Create Reports, Submit Form in the form preview. */
  label?: string;
};

/**
 * Submit Report and, under it, what still stands in the way. The reason stays beside the button
 * (not in a passing toast); pressing the button while it is blocked draws attention to it again.
 * The form preview uses the same control, so both start the one submit flow.
 */
export function ReportDraftActions({
  isReadOnly,
  isPeriodChanging,
  metricsError,
  validationError,
  isLoadingCounts = false,
  fixDay = null,
  onSubmitPrompt,
  label = "Submit Report",
}: ReportDraftActionsProps) {
  const warning = metricsError ?? validationError;
  const noteId = useId();
  // Each blocked press remounts the note, so it is announced and highlighted again.
  const [attention, setAttention] = useState(0);

  if (isReadOnly) return null;

  return (
    <div className="report-submit-action">
      <button
        type="button"
        disabled={isPeriodChanging}
        aria-disabled={Boolean(warning) || undefined}
        aria-describedby={warning ? noteId : undefined}
        onClick={() => {
          if (warning) setAttention((value) => value + 1);
          else onSubmitPrompt();
        }}
        className="reports-button reports-primary report-submit-button"
      >
        <Send size={14} aria-hidden="true" />
        {label}
      </button>
      {warning && (
        <div
          key={attention}
          id={noteId}
          className="report-submit-note"
          data-tone={isLoadingCounts ? "loading" : "blocked"}
          data-attention={attention > 0 || undefined}
          role={attention > 0 ? "alert" : undefined}
        >
          {isLoadingCounts ? <LoaderCircle className="report-submit-note-spin" aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <p>
            {warning}
            {fixDay && !metricsError && (
              <>
                {" "}
                <button type="button" className="reports-text-button" onClick={fixDay.onShow}>
                  {fixDay.label}
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
