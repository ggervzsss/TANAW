import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useId, useState } from "react";
import toast from "react-hot-toast/headless";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { addNoteForIt, requestDetailQueryKey, requestsQueryKey, type Request } from "@/shared/services/requests";
import { Button, Textarea, cn } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { quickInstructions, requestPlace } from "../model";

const MAX_NOTE_LENGTH = 2000;

type NoteForItComposerProps = {
  request: Request;
  /** "the IT team", or "Carlo Mendoza and the IT team" once someone has taken the request. */
  recipients: string;
};

/**
 * Lets an Admin add a note for IT on a request. IT sees the note on the request and gets a
 * notification; the enterprise never sees it. The Admin can't change a request's status.
 * Mount it with `key={request.id}` so choosing another request clears the draft.
 */
export function NoteForItComposer({ request, recipients }: NoteForItComposerProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const labelId = useId();
  const fieldId = useId();
  const statusId = useId();
  const instructions = quickInstructions(request);
  const message = draft.trim();
  const empty = message === "";

  const mutation = useMutation({
    mutationFn: (text: string) => addNoteForIt(request.id, text),
    onSuccess: (detail) => {
      queryClient.setQueryData(requestDetailQueryKey(request.id), detail);
      void queryClient.invalidateQueries({ queryKey: requestsQueryKey });
      void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
      setDraft("");
      toast.success(
        <>
          <span className="block font-bold">Note sent to IT</span>
          <span className="mt-0.5 block text-[0.8125rem] font-normal">
            {sentenceCase(recipients)} will see it on {request.code}.
          </span>
        </>,
      );
    },
    onError: (failure) => {
      const failureMessage = getApiErrorMessage(failure, "The note could not be added. Try again.");
      setError(failureMessage);
      toast.error(
        <>
          <span className="block font-bold">Note not sent</span>
          <span className="mt-0.5 block text-[0.8125rem] font-normal">{failureMessage}</span>
        </>,
      );
    },
  });

  const send = () => {
    if (empty || mutation.isPending) return;
    setError("");
    mutation.mutate(message);
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    setError("");
  };

  return (
    <section aria-labelledby={`${labelId}-heading`} className="mt-3.5 border-t border-(--tanaw-border-soft) pt-4.5">
      <h3 id={`${labelId}-heading`} className="text-base font-bold">
        Add a note for IT
      </h3>
      <p className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">Tell IT what you need done about this request. It goes to {recipients} and is added to Latest updates. The enterprise doesn't see it.</p>

      <p id={labelId} className="mt-3 text-xs font-semibold text-(--tanaw-text-secondary)">
        Quick instructions
      </p>
      <div role="group" aria-labelledby={labelId} className="mt-1.5 flex flex-wrap gap-2">
        {instructions.map((instruction) => {
          const pressed = draft === instruction.text;
          return (
            <button
              key={instruction.label}
              type="button"
              aria-pressed={pressed}
              onClick={() => changeDraft(instruction.text)}
              className={cn(
                "min-h-9 cursor-pointer rounded-full border px-3.5 text-[0.84375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                pressed
                  ? "border-(--tanaw-action) bg-(--tanaw-row-selected) text-(--tanaw-accent-ink)"
                  : "border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text) hover:border-(--tanaw-accent-ink) hover:bg-(--tanaw-control-hover)",
              )}
            >
              {instruction.label}
            </button>
          );
        })}
      </div>

      <label htmlFor={fieldId} className="mt-3.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
        Your note
      </label>
      <Textarea
        id={fieldId}
        value={draft}
        rows={3}
        maxLength={MAX_NOTE_LENGTH}
        placeholder={`For example: Can someone go to ${requestPlace(request)} to check this, please?`}
        onChange={(event) => changeDraft(event.target.value)}
        aria-describedby={error ? statusId : undefined}
        invalid={Boolean(error)}
        className="mt-1.5 min-h-21"
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          leadingIcon={<Send size={16} aria-hidden="true" />}
          aria-disabled={empty || undefined}
          loading={mutation.isPending}
          onClick={send}
          className={cn("h-11 text-sm", empty && "cursor-default opacity-50 hover:bg-(--tanaw-action) active:translate-y-0")}
        >
          Add note
        </Button>
        {error && (
          <p id={statusId} className="text-[0.84375rem] font-semibold text-(--tanaw-error)">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
