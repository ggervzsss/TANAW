import { MessageSquare, Send } from "lucide-react";
import { canReplyToRequest, type RequestDetail } from "@/shared/services/requests";
import { Button, Textarea, cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { useTicketConversation } from "../hooks";
import { authorRoleLabel, formatTicketTime } from "../model";

type TicketConversationProps = {
  isItResponder: boolean;
  isReplyPending: boolean;
  onReplyChange: (value: string) => void;
  onReplySubmit: () => void;
  reply: string;
  replyError: string;
  ticket: RequestDetail;
  timeFormat: SystemTimeFormat;
};

const heading = "flex items-center gap-2 text-[0.9375rem] font-[650] text-(--tanaw-text)";

export function TicketConversation({ isItResponder, isReplyPending, onReplyChange, onReplySubmit, reply, replyError, ticket, timeFormat }: TicketConversationProps) {
  const { announcement, conversationRef, handleScroll, hasNewMessage, scrollToLatest } = useTicketConversation(ticket);

  return (
    <section className="support-tickets__section">
      <h4 className={heading}>
        <MessageSquare size={16} aria-hidden="true" className="text-(--tanaw-accent-ink)" />
        Conversation
      </h4>
      <div ref={conversationRef} onScroll={handleScroll} className="mt-4 max-h-80 space-y-2 overflow-y-auto overscroll-contain pr-3">
        <ConversationItem authorName={ticket.requesterName} authorRole="requester" createdAt={ticket.createdAt} message={ticket.description} timeFormat={timeFormat} />
        {(ticket.messages ?? [])
          .filter((message) => message.kind !== "status")
          .map((message) => (
            <ConversationItem
              key={message.id}
              authorName={message.kind === "note" ? `${message.authorName} (note for IT)` : message.authorName}
              authorRole={message.authorRole}
              createdAt={message.createdAt}
              message={message.message}
              timeFormat={timeFormat}
            />
          ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {hasNewMessage && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="rounded-tanaw-md mt-3 w-full bg-(--tanaw-selected-bg) px-3 py-2 text-[13px] font-semibold text-(--tanaw-accent-ink) transition-colors duration-150 hover:bg-(--tanaw-interactive-active-bg)"
        >
          New message
        </button>
      )}

      {!canReplyToRequest(ticket) ? (
        <p className="rounded-tanaw-md mt-4 bg-(--tanaw-surface-inset) px-4 py-3 text-sm text-(--tanaw-text-secondary)">
          This request is closed, so the conversation is closed too.
          {isItResponder && ticket.status === "Resolved" ? " Reopen it to continue the conversation." : ""}
        </p>
      ) : isItResponder ? (
        <div className="mt-4 border-t border-(--tanaw-border-soft) pt-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">IT Response</span>
            <Textarea value={reply} onChange={(event) => onReplyChange(event.target.value)} rows={4} placeholder="Write a response for the requester..." className="resize-none" />
          </label>
          {replyError && <p className="mt-2 text-[13px] font-medium text-(--tanaw-error)">{replyError}</p>}
          <Button onClick={onReplySubmit} loading={isReplyPending} leadingIcon={<Send size={15} aria-hidden="true" />} className="mt-3">
            {isReplyPending ? "Sending..." : "Send Reply"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ConversationItem({ authorName, authorRole, createdAt, message, timeFormat }: { authorName: string; authorRole: string; createdAt: string; message: string; timeFormat: SystemTimeFormat }) {
  const isRequester = authorRole === "enterprise" || authorRole === "requester";
  return (
    <article className={cn("rounded-tanaw-md px-3.5 py-3", isRequester ? "bg-(--tanaw-selected-bg)" : "bg-(--tanaw-information-surface)")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-(--tanaw-text)">{authorName}</p>
        <p className="text-xs text-(--tanaw-text-muted)">
          {authorRoleLabel(authorRole)} / {formatTicketTime(createdAt, timeFormat)}
        </p>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-(--tanaw-text-secondary)">{message}</p>
    </article>
  );
}
