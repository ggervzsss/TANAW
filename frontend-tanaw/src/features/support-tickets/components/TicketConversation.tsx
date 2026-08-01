import { MessageSquare, RefreshCw, Send } from "lucide-react";
import { canReplyToSupportTicket, type SupportTicketDetail } from "@/shared/services/supportTickets";
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
  ticket: SupportTicketDetail;
  timeFormat: SystemTimeFormat;
};

export function TicketConversation({ isItResponder, isReplyPending, onReplyChange, onReplySubmit, reply, replyError, ticket, timeFormat }: TicketConversationProps) {
  const { announcement, conversationRef, handleScroll, hasNewMessage, scrollToLatest } = useTicketConversation(ticket);

  return (
    <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
      <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
        <MessageSquare size={16} className="text-emerald-700" />
        Conversation
      </h4>
      <div ref={conversationRef} onScroll={handleScroll} className="mt-4 max-h-80 space-y-3 overflow-y-auto overscroll-contain pr-1">
        <ConversationItem authorName={ticket.submittedBy} authorRole="requester" createdAt={ticket.createdAt} message={ticket.description} timeFormat={timeFormat} />
        {ticket.messages.map((message) => (
          <ConversationItem key={message.id} authorName={message.authorName} authorRole={message.authorRole} createdAt={message.createdAt} message={message.message} timeFormat={timeFormat} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {hasNewMessage && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="mt-3 w-full rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-200"
        >
          New message
        </button>
      )}

      {!canReplyToSupportTicket(ticket) ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-100">
          This ticket is resolved. The conversation is now closed.
          {isItResponder ? " Reopen the ticket to continue the conversation." : ""}
        </div>
      ) : isItResponder ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="block">
            <span className="mb-2 block text-[11px] font-black tracking-wide text-slate-500 uppercase">IT Response</span>
            <textarea
              value={reply}
              onChange={(event) => onReplyChange(event.target.value)}
              rows={4}
              placeholder="Write a response for the requester..."
              className="w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-950 transition outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            />
          </label>
          {replyError && <p className="mt-2 text-xs font-bold text-red-700">{replyError}</p>}
          <button
            type="button"
            onClick={onReplySubmit}
            disabled={isReplyPending}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700/60"
          >
            {isReplyPending ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
            {isReplyPending ? "Sending..." : "Send Reply"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ConversationItem({ authorName, authorRole, createdAt, message, timeFormat }: { authorName: string; authorRole: string; createdAt: string; message: string; timeFormat: SystemTimeFormat }) {
  const isRequester = authorRole === "enterprise" || authorRole === "requester";
  return (
    <article
      className={`rounded-2xl border p-3 ${isRequester ? "border-emerald-100 bg-emerald-50/70 dark:border-emerald-300/20 dark:bg-emerald-500/10" : "border-blue-100 bg-blue-50/70 dark:border-blue-300/20 dark:bg-blue-500/10"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-950">{authorName}</p>
        <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
          {authorRoleLabel(authorRole)} / {formatTicketTime(createdAt, timeFormat)}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{message}</p>
    </article>
  );
}
