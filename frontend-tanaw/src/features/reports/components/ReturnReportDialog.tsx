import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Dialog, Textarea, cn } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";
import { RETURN_REASON_MAX_LENGTH, returnReasonCount, returnReasonError, returnReportExplanation } from "../model/reportReturns";

type ReturnReportDialogProps = {
  report: IntakeReport;
  isPending: boolean;
  /** Why the last attempt failed (from the server); cleared once the reason is edited. */
  error: string | null;
  onDismissError: () => void;
  onCancel: () => void;
  /** Called with the trimmed reason once it is valid. */
  onSubmit: (reason: string) => void;
};

/**
 * Asks what the enterprise needs to correct before a report goes back to it. Opens over the report
 * dialog with the reason field focused; the reason is checked when Return report is pressed and then
 * as it is edited, and it is kept if the return fails.
 */
export function ReturnReportDialog({ report, isPending, error, onDismissError, onCancel, onSubmit }: ReturnReportDialogProps) {
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const fieldId = useId();
  const hintId = useId();
  const countId = useId();
  const errorId = useId();
  const invalid = attempted ? returnReasonError(reason, report.enterprise) : null;
  const message = invalid ?? error;
  const nearLimit = reason.length >= RETURN_REASON_MAX_LENGTH - 50;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setAttempted(true);
    if (returnReasonError(reason, report.enterprise)) {
      fieldRef.current?.focus();
      return;
    }
    onSubmit(reason.trim());
  };

  const cancel = () => {
    if (!isPending) onCancel();
  };

  return (
    <Dialog
      title="Return this report for correction"
      description={returnReportExplanation(report.enterprise)}
      size="md"
      className="tanaw-report-sheet"
      onClose={cancel}
      closeOnBackdrop={!isPending}
      closeLabel="Cancel returning the report"
      initialFocus="[data-return-reason]"
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={isPending}>
            {isPending ? "Returning…" : "Return report"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        <label htmlFor={fieldId} className="block text-[13px] font-semibold text-(--tanaw-text-secondary)">
          What needs to be corrected
        </label>
        <Textarea
          ref={fieldRef}
          id={fieldId}
          data-return-reason
          value={reason}
          rows={5}
          maxLength={RETURN_REASON_MAX_LENGTH}
          required
          readOnly={isPending}
          invalid={Boolean(message)}
          aria-describedby={`${message ? errorId : hintId} ${countId}`}
          placeholder="For example: The visitor origins for the last week add up to more than that week's unique visitors. Please recount them."
          onChange={(event) => {
            setReason(event.target.value);
            if (error) onDismissError();
          }}
          className="mt-2 min-h-32"
        />
        <div className="mt-1.5 flex items-start justify-between gap-4 text-[13px]">
          {message ? (
            <p id={errorId} role="alert" className="min-w-0 font-medium wrap-anywhere text-(--tanaw-error)">
              {message}
            </p>
          ) : (
            <p id={hintId} className="min-w-0 text-(--tanaw-text-muted)">
              Name the days or figures to check, so {report.enterprise} can fix them on the first try.
            </p>
          )}
          <p id={countId} className={cn("shrink-0 tabular-nums", nearLimit ? "font-medium text-(--tanaw-st-pending)" : "text-(--tanaw-text-muted)")}>
            <span aria-hidden="true">
              {reason.length} / {RETURN_REASON_MAX_LENGTH}
            </span>
            <span className="sr-only">{returnReasonCount(reason)}</span>
          </p>
        </div>
      </form>
    </Dialog>
  );
}
