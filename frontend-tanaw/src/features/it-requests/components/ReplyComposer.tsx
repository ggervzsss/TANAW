import { Check, Send } from "lucide-react";
import { useId } from "react";
import type { Request } from "@/shared/services/requests";
import { Button, Textarea, cn } from "@/shared/ui-kit";
import { quickReplies, replyHint, requestActions, senderName } from "../model";

const MAX_REPLY_LENGTH = 2000;

type ReplyComposerProps = {
  request: Request;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Which action is running, if any. */
  pending: string | null;
  onSend: (resolve: boolean) => void;
};

/** "Reply to Nora": quick replies, the reply field, Send reply and Send and mark resolved. */
export function ReplyComposer({ request, draft, onDraftChange, pending, onSend }: ReplyComposerProps) {
  const headingId = useId();
  const quickLabelId = useId();
  const fieldId = useId();
  const hintId = useId();
  const actions = requestActions(request);
  const empty = draft.trim() === "";
  const busy = pending !== null;

  if (!actions.canReply) {
    return (
      <section aria-labelledby={headingId} className="mt-4 border-t border-(--tanaw-border-soft) pt-5">
        <h3 id={headingId} className="text-base font-[650]">
          Reply to {senderName(request)}
        </h3>
        <p className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">
          {actions.canReopen ? "This request is resolved. Reopen it to reply." : "This change is decided, so the conversation is closed."}
        </p>
      </section>
    );
  }

  const send = (resolve: boolean) => {
    if (empty || busy) return;
    onSend(resolve);
  };

  return (
    <section aria-labelledby={headingId} className="mt-4 border-t border-(--tanaw-border-soft) pt-5">
      <h3 id={headingId} className="text-base font-[650]">
        Reply to {senderName(request)}
      </h3>
      <p id={hintId} className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">
        {replyHint(request)}
      </p>

      <p id={quickLabelId} className="mt-3 text-[13px] font-medium text-(--tanaw-text-secondary)">
        Quick replies
      </p>
      <div role="group" aria-labelledby={quickLabelId} className="mt-1.5 flex flex-wrap gap-2">
        {quickReplies(request).map((reply) => {
          const pressed = draft === reply.text;
          return (
            <button
              key={reply.label}
              type="button"
              aria-pressed={pressed}
              onClick={() => onDraftChange(reply.text)}
              className={cn(
                "group rounded-tanaw-md ease-tanaw-out inline-flex min-h-9 cursor-pointer items-center gap-1.5 px-3.5 text-[0.84375rem] font-medium transition-[background-color,color,translate,scale] duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:translate-y-0 active:scale-[0.97] motion-reduce:transition-colors motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
                pressed ? "bg-(--tanaw-selected-bg) font-semibold text-(--tanaw-accent-ink)" : "bg-(--tanaw-control-bg) text-(--tanaw-text) hover:bg-(--tanaw-control-bg-hover)",
              )}
            >
              {pressed && <Check size={14} strokeWidth={2.6} aria-hidden="true" className="tanaw-pop-in -ml-0.5" />}
              {reply.label}
            </button>
          );
        })}
      </div>

      <label htmlFor={fieldId} className="mt-4 block text-[13px] font-medium text-(--tanaw-text-secondary)">
        Your reply
      </label>
      <Textarea
        id={fieldId}
        value={draft}
        rows={3}
        maxLength={MAX_REPLY_LENGTH}
        placeholder="Write what you found or what they should do next."
        aria-describedby={hintId}
        onChange={(event) => onDraftChange(event.target.value)}
        className="mt-1.5 min-h-24"
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          leadingIcon={<Send size={16} aria-hidden="true" />}
          aria-disabled={empty || busy || undefined}
          loading={pending === "reply"}
          onClick={() => send(false)}
          className={cn("h-11 text-sm", (empty || busy) && "cursor-default opacity-50 hover:bg-(--tanaw-action) active:translate-y-0")}
        >
          Send reply
        </Button>
        {actions.canResolve && (
          <Button
            variant="secondary"
            size="lg"
            aria-disabled={empty || busy || undefined}
            onClick={() => send(true)}
            className={cn("h-11 text-sm", (empty || busy) && "cursor-default opacity-50 hover:bg-(--tanaw-control-bg) active:translate-y-0")}
          >
            Send and mark resolved
          </Button>
        )}
      </div>
    </section>
  );
}
