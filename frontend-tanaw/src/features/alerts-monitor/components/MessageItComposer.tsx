import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useId, useState } from "react";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import type { SystemLog } from "@/shared/types";
import { Button, Textarea, cn } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { quickInstructions, type AdminRequest } from "../model";
import { MAX_REQUEST_MESSAGE_LENGTH, sendRequestMessage, type AdminRequestMessageResult } from "../services/requestMessages";

type MessageItComposerProps = {
  request: AdminRequest;
  /** "the IT team", or "Carlo Mendoza and the IT team" once someone has taken the request. */
  recipients: string;
};

/**
 * Lets an Admin tell IT what to do about a request. The message reaches IT as a notification and is
 * kept in the Admin activity history; it never joins the enterprise's ticket conversation.
 * Mount it with `key={request.key}` so choosing another request clears the draft.
 */
export function MessageItComposer({ request, recipients }: MessageItComposerProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<AdminRequestMessageResult | null>(null);
  const [error, setError] = useState("");
  const labelId = useId();
  const fieldId = useId();
  const statusId = useId();
  const instructions = quickInstructions(request);
  const message = draft.trim();
  const empty = message === "";

  const mutation = useMutation({
    mutationFn: sendRequestMessage,
    onSuccess: (sent) => {
      const log = toSystemLog(sent.activity);
      queryClient.setQueryData<SystemLog[]>(activityLogsQueryKey, (current) => [log, ...(current ?? []).filter((item) => item.id !== log.id)]);
      void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
      setDraft("");
      setResult(sent);
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "The message could not be sent. Try again.")),
  });

  const send = () => {
    if (empty || mutation.isPending) return;
    setError("");
    setResult(null);
    mutation.mutate({ sourceType: request.sourceType, sourceId: request.sourceId, message });
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    setResult(null);
    setError("");
  };

  return (
    <section aria-labelledby={`${labelId}-heading`} className="mt-3.5 border-t border-(--tanaw-border-soft) pt-4.5">
      <h3 id={`${labelId}-heading`} className="text-base font-bold">
        Message IT
      </h3>
      <p className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">Tell IT what you need done about this request. It goes to {recipients} and is added to Latest updates.</p>

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
        Your message
      </label>
      <Textarea
        id={fieldId}
        value={draft}
        rows={3}
        maxLength={MAX_REQUEST_MESSAGE_LENGTH}
        placeholder={`For example: Can someone go to ${request.place} to check this, please?`}
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
          Send to IT
        </Button>
        <p id={statusId} role="status" className={cn("text-[0.84375rem] font-semibold", error ? "text-(--tanaw-error)" : "text-(--tanaw-accent-ink)")}>
          {error || (result ? sentMessage(result.recipientCount) : "")}
        </p>
      </div>
    </section>
  );
}

function sentMessage(recipientCount: number) {
  if (recipientCount === 0) return "Message saved. No active IT account was found to notify.";
  return "Message sent to IT.";
}

function toSystemLog(activity: AdminRequestMessageResult["activity"]): SystemLog {
  return {
    ...activity,
    sourceId: activity.sourceId ?? undefined,
    metadata: activity.metadata ?? undefined,
  };
}
