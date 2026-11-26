import { Send } from "lucide-react";
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
      <section aria-labelledby={headingId} className="mt-3.5 border-t border-(--tanaw-border-soft) pt-4.5">
        <h3 id={headingId} className="text-base font-bold">
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
    <section aria-labelledby={headingId} className="mt-3.5 border-t border-(--tanaw-border-soft) pt-4.5">
      <h3 id={headingId} className="text-base font-bold">
        Reply to {senderName(request)}
      </h3>
      <p id={hintId} className="mt-1 text-[0.84375rem] text-(--tanaw-text-secondary)">
        {replyHint(request)}
      </p>

      <p id={quickLabelId} className="mt-3 text-xs font-semibold text-(--tanaw-text-secondary)">
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
                "min-h-9 cursor-pointer rounded-full border px-3.5 text-[0.84375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                pressed
                  ? "border-(--tanaw-action) bg-(--tanaw-row-selected) text-(--tanaw-accent-ink)"
                  : "border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text) hover:border-(--tanaw-accent-ink) hover:bg-(--tanaw-control-hover)",
              )}
            >
              {reply.label}
            </button>
          );
        })}
      </div>

      <label htmlFor={fieldId} className="mt-3.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
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
