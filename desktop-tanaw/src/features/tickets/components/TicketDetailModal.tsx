import { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ImageIcon, MessageSquare, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import type { SystemTimeFormat } from "../../../utils/date-time";
import { canReplyToSupportTicket, replyToSupportTicket, type SupportTicketAttachment, type SupportTicketDetail } from "../services/tickets";
import { useTicketAttachmentImageUrl } from "../hooks/useTicketAttachmentImageUrl";
import { TicketBadge, TicketStatusBadge } from "./TicketPresentation";
import { formatFileSize, formatTicketTime, getTicketRequestError } from "../utils/ticket-presentation";

type TicketDetailModalProps = {
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onPreviewPhoto: (photo: SupportTicketAttachment) => void;
  onTicketUpdated: (ticket: SupportTicketDetail) => void;
  ticket: SupportTicketDetail | null;
  timeFormat: SystemTimeFormat;
};

export function TicketDetailModal({ error, isLoading, onClose, onPreviewPhoto, onTicketUpdated, ticket, timeFormat }: TicketDetailModalProps) {
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const latestMessageId = ticket?.messages[ticket.messages.length - 1]?.id;
  const previousMessageIdRef = useRef<string | undefined>(latestMessageId);
  const isNearConversationBottomRef = useRef(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !latestMessageId || latestMessageId === previousMessageIdRef.current) return;
    previousMessageIdRef.current = latestMessageId;
    if (isNearConversationBottomRef.current) {
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      setHasNewMessage(false);
    } else {
      setHasNewMessage(true);
    }
  }, [latestMessageId]);

  const scrollToLatestMessage = () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    isNearConversationBottomRef.current = true;
    setHasNewMessage(false);
  };

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = reply.trim();
    if (!ticket || !canReplyToSupportTicket(ticket)) return;
    if (!message) {
      setReplyError("Write a message before sending your reply.");
      return;
    }
    setIsReplying(true);
    setReplyError("");
    try {
      const updatedTicket = await replyToSupportTicket(ticket.id, message);
      onTicketUpdated(updatedTicket);
      setReply("");
      notifySuccess(`Reply added to ${updatedTicket.code}.`);
    } catch (requestError) {
      const messageText = getTicketRequestError(requestError, "Unable to send the ticket reply.");
      setReplyError(messageText);
      notifyError(messageText);
    } finally {
      setIsReplying(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center overflow-y-auto bg-[#03140c]/70 p-4 backdrop-blur-md" onPointerDown={onClose}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label={ticket?.subject ?? "Support ticket details"}
          className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/5 dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.5)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="h-1.5 bg-linear-to-r from-[#065f46] via-[#34d399] to-[#d9b44a]" />
          <header className="relative flex items-start justify-between gap-4 border-b border-emerald-100/80 bg-linear-to-r from-emerald-50 via-white to-amber-50/70 px-6 py-5 dark:border-slate-600 dark:from-[#0f2d3c] dark:via-[#172033] dark:to-[#312638]">
            <span className="pointer-events-none absolute bottom-0 left-6 h-px w-24 bg-[#d9b44a]/70" aria-hidden="true" />
            <div className="min-w-0">
              <p className="mb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700/80 uppercase dark:text-emerald-200/90">{ticket?.code ?? "Support Ticket"}</p>
              <h3 className="truncate text-xl font-black tracking-tight text-[#111827] dark:text-white">{ticket?.subject ?? "Ticket Details"}</h3>
            </div>
            <button
              type="button"
              aria-label="Close ticket details"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-[#065f46] focus:ring-4 focus:ring-[#065f46]/15 focus:outline-none dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-[#1d2940]"
            >
              <X size={18} />
            </button>
          </header>

          <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto bg-white p-6 dark:bg-[#121c31]">
            {isLoading && (
              <div className="flex min-h-72 flex-col items-center justify-center text-center">
                <RefreshCw size={28} className="animate-spin text-[#065f46] dark:text-emerald-200" />
                <p className="mt-3 text-sm font-black text-[#111827] dark:text-slate-100">Loading ticket details</p>
                <p className="mt-1 text-xs font-semibold text-gray-500 dark:text-slate-300">Fetching backend-backed support ticket data.</p>
              </div>
            )}

            {!isLoading && error && (
              <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-950/35 dark:text-red-100">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {!isLoading && !error && ticket && (
              <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <section className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50/80 via-white to-amber-50/60 p-5 dark:border-emerald-300/20 dark:from-emerald-500/10 dark:via-[#172033] dark:to-amber-500/10">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold tracking-wide text-[#065f46] dark:text-emerald-200">{ticket.code}</p>
                        <h4 className="mt-1 text-lg font-black text-[#111827] dark:text-slate-100">{ticket.subject}</h4>
                        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-slate-300">{ticket.description}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <TicketStatusBadge status={ticket.status} />
                        <TicketBadge tone={ticket.priority === "Urgent" || ticket.priority === "High" ? "warning" : "neutral"}>{ticket.priority}</TicketBadge>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <DetailTile label="Enterprise" value={ticket.enterpriseName} />
                    <DetailTile label="Enterprise ID" value={ticket.enterpriseId} mono />
                    <DetailTile label="Category" value={ticket.category} />
                    <DetailTile label="Submitted" value={formatTicketTime(ticket.createdAt, timeFormat)} />
                    {ticket.affectedArea ? <DetailTile label="Affected Area" value={ticket.affectedArea} /> : null}
                    {ticket.cameraNode ? <DetailTile label="Camera" value={ticket.cameraNode} /> : null}
                  </section>

                  <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f172a]">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-[#111827] uppercase dark:text-white">
                        <Paperclip size={16} className="text-[#065f46] dark:text-emerald-200" />
                        Photos
                      </h4>
                      <span className="text-[11px] font-bold text-gray-400 uppercase dark:text-slate-300">{ticket.attachments.length} attached</span>
                    </div>
                    {ticket.attachments.length > 0 ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {ticket.attachments.map((attachment, index) => (
                          <button
                            key={attachment.id ?? `${attachment.fileName}-${index}`}
                            type="button"
                            onClick={() => onPreviewPhoto(attachment)}
                            className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-left transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-600 dark:bg-[#121c31] dark:hover:border-emerald-300/40 dark:hover:bg-emerald-500/10"
                          >
                            <TicketAttachmentImage attachment={attachment} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-gray-200 dark:ring-slate-700" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-[#111827] dark:text-slate-100">{attachment.fileName}</span>
                              <span className="mt-1 block text-[11px] font-semibold text-gray-500 dark:text-slate-300">{formatFileSize(attachment.sizeBytes)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm font-semibold text-gray-500 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-300">
                        No photos were attached to this ticket.
                      </p>
                    )}
                  </section>
                </div>

                <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f172a]">
                  <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-[#111827] uppercase dark:text-white">
                    <MessageSquare size={16} className="text-[#065f46] dark:text-emerald-200" />
                    Conversation
                  </h4>
                  <div
                    ref={conversationRef}
                    aria-live="polite"
                    className="mt-4 max-h-[38dvh] space-y-3 overflow-y-auto pr-1"
                    onScroll={(event) => {
                      const element = event.currentTarget;
                      isNearConversationBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
                      if (isNearConversationBottomRef.current) setHasNewMessage(false);
                    }}
                  >
                    <ConversationItem authorName={ticket.submittedBy} authorRole="enterprise" createdAt={ticket.createdAt} message={ticket.description} timeFormat={timeFormat} />
                    {ticket.messages.map((message) => (
                      <ConversationItem
                        key={message.id}
                        authorName={message.authorName}
                        authorRole={message.authorRole}
                        createdAt={message.createdAt}
                        message={message.message}
                        timeFormat={timeFormat}
                      />
                    ))}
                  </div>
                  {hasNewMessage ? (
                    <button
                      type="button"
                      onClick={scrollToLatestMessage}
                      className="mt-3 w-full rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:border-emerald-300/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                    >
                      New message
                    </button>
                  ) : null}
                  {!canReplyToSupportTicket(ticket) ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                      This ticket is resolved. The conversation is now closed. Contact IT by creating a new ticket if further assistance is needed.
                    </div>
                  ) : (
                    <form className="mt-4 space-y-3 border-t border-emerald-100 pt-4 dark:border-slate-700" onSubmit={handleReply}>
                      <label className="block">
                        <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">Reply in TANAW</span>
                        <textarea
                          value={reply}
                          maxLength={2000}
                          onChange={(event) => {
                            setReply(event.target.value);
                            if (replyError) setReplyError("");
                          }}
                          className="min-h-24 w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-[#111827] transition outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100 dark:focus:border-emerald-300/40"
                          placeholder="Add information or respond to IT"
                        />
                      </label>
                      {replyError ? <p className="text-xs font-semibold text-red-700 dark:text-red-200">{replyError}</p> : null}
                      <button
                        type="submit"
                        disabled={isReplying}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#065f46] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#044a36] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isReplying ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                        {isReplying ? "Sending..." : "Send Reply"}
                      </button>
                    </form>
                  )}
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

export function PhotoPreviewModal({ onClose, photo }: { onClose: () => void; photo: SupportTicketAttachment }) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1200 flex items-center justify-center overflow-y-auto bg-[#03140c]/75 p-4 backdrop-blur-md" onPointerDown={onClose}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label={photo.fileName}
          className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/5 dark:border-slate-600 dark:bg-[#121c31]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="h-1.5 bg-linear-to-r from-[#065f46] via-[#34d399] to-[#d9b44a]" />
          <header className="relative flex items-start justify-between gap-4 border-b border-emerald-100/80 bg-linear-to-r from-emerald-50 via-white to-amber-50/70 px-6 py-5 dark:border-slate-600 dark:from-[#0f2d3c] dark:via-[#172033] dark:to-[#312638]">
            <span className="pointer-events-none absolute bottom-0 left-6 h-px w-24 bg-[#d9b44a]/70" aria-hidden="true" />
            <div className="min-w-0">
              <p className="mb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700/80 uppercase dark:text-emerald-200/90">Ticket Photo</p>
              <h3 className="truncate text-xl font-black tracking-tight text-[#111827] dark:text-white">{photo.fileName}</h3>
            </div>
            <button
              type="button"
              aria-label="Close photo preview"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-[#065f46] focus:ring-4 focus:ring-[#065f46]/15 focus:outline-none dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-[#1d2940]"
            >
              <X size={18} />
            </button>
          </header>
          <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto bg-white p-5 dark:bg-[#121c31]">
            <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-600 dark:bg-[#0f172a]">
              <TicketAttachmentImage attachment={photo} alt={photo.fileName} className="max-h-[70vh] min-h-72 w-full rounded-2xl object-contain" showError />
            </div>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function TicketAttachmentImage({ alt, attachment, className, showError = false }: { alt: string; attachment: SupportTicketAttachment; className: string; showError?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);

  if (error || isLoading || !imageUrl) {
    return (
      <div
        className={`${className} flex items-center justify-center border border-dashed border-gray-200 bg-white text-center text-gray-500 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-300`}
      >
        <span className="flex max-w-full flex-col items-center gap-2 px-3">
          {isLoading ? <RefreshCw size={showError ? 28 : 18} className="animate-spin text-[#065f46] dark:text-emerald-200" /> : <ImageIcon size={showError ? 30 : 18} />}
          {showError && <span className="text-sm font-semibold">{error || "Loading image"}</span>}
        </span>
      </div>
    );
  }

  return <img src={imageUrl} alt={alt} className={className} />;
}

function DetailTile({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm dark:border-slate-600 dark:bg-[#0f172a]">
      <p className="text-[10px] font-black tracking-[0.16em] text-gray-500 uppercase dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold wrap-break-word text-[#111827] dark:text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function ConversationItem({ authorName, authorRole, createdAt, message, timeFormat }: { authorName: string; authorRole: string; createdAt: string; message: string; timeFormat: SystemTimeFormat }) {
  const isEnterprise = authorRole === "enterprise";
  return (
    <article
      className={`rounded-2xl border p-3 ${
        isEnterprise ? "border-emerald-100 bg-emerald-50/70 dark:border-emerald-300/20 dark:bg-emerald-500/10" : "border-blue-100 bg-blue-50/70 dark:border-blue-300/20 dark:bg-blue-500/10"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-[#111827] dark:text-slate-100">{authorName}</p>
        <p className="text-[10px] font-bold tracking-wide text-gray-500 uppercase dark:text-slate-300">
          {authorRoleLabel(authorRole)} / {formatTicketTime(createdAt, timeFormat)}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-slate-200">{message}</p>
    </article>
  );
}

function authorRoleLabel(role: string) {
  if (role === "it") return "IT Personnel";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  if (role === "enterprise") return "Enterprise";
  return role;
}
