import { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ImageIcon, MessageSquare, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { Skeleton, useDialogFocus } from "../../../ui-kit";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import type { SystemTimeFormat } from "../../../utils/date-time";
import { canReopenSupportTicket, canReplyToSupportTicket, reopenSupportTicket, replyToSupportTicket, type SupportTicketAttachment, type SupportTicketDetail } from "../services/tickets";
import { useTicketAttachmentImageUrl } from "../hooks/useTicketAttachmentImageUrl";
import { TicketStatusBadge } from "./TicketPresentation";
import { formatFileSize, formatTicketTime, getTicketRequestError } from "../utils/ticket-presentation";

type TicketDetailModalProps = {
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onPreviewPhoto: (photo: SupportTicketAttachment) => void;
  onTicketUpdated: (ticket: SupportTicketDetail) => void;
  ticket: SupportTicketDetail | null;
  timeFormat: SystemTimeFormat;
  /** True while a photo preview sits on top, so Escape closes only the preview. */
  covered?: boolean;
};

export function TicketDetailModal({ covered = false, error, isLoading, onClose, onPreviewPhoto, onTicketUpdated, ticket, timeFormat }: TicketDetailModalProps) {
  const panelRef = useRef<HTMLElement>(null);
  // Paused, not disabled, under the photo preview: disabling would run the cleanup and move focus
  // behind this dialog, so the preview could not return focus to the photo that opened it.
  useDialogFocus(panelRef, onClose, true, undefined, covered);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
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

  async function handleReopen() {
    if (!ticket || !canReopenSupportTicket(ticket)) return;
    setIsReopening(true);
    try {
      const updatedTicket = await reopenSupportTicket(ticket.id);
      onTicketUpdated(updatedTicket);
      notifySuccess(`${updatedTicket.code} is open again.`);
    } catch (requestError) {
      notifyError(getTicketRequestError(requestError, "Unable to reopen the request."));
    } finally {
      setIsReopening(false);
    }
  }

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
      const messageText = getTicketRequestError(requestError, "Unable to send the reply.");
      setReplyError(messageText);
      notifyError(messageText);
    } finally {
      setIsReplying(false);
    }
  }

  return (
    <ModalPortal>
      <div className="tanaw-backdrop-enter fixed inset-0 z-1100 flex items-center justify-center overflow-y-auto bg-[rgb(3_20_12/0.6)] p-4 backdrop-blur-[6px]" onPointerDown={onClose}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label={ticket?.title ?? "Request details"}
          ref={panelRef}
          tabIndex={-1}
          className="tanaw-dialog-enter my-auto max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden rounded-tanaw-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) shadow-tanaw-raised outline-none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div aria-hidden="true" className="h-1 bg-(image:--tanaw-metric-thread)" />
          <header className="relative flex items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-6 pt-5 pb-4">
            <div className="min-w-0">
              <p className="mb-1 font-mono text-xs font-semibold tracking-[0.12em] text-(--tanaw-gold-ink) uppercase">{ticket?.code ?? "Request"}</p>
              <h3 className="truncate font-display text-xl leading-tight font-bold text-(--tanaw-text)">{ticket?.title ?? "Request Details"}</h3>
            </div>
            <button
              type="button"
              aria-label="Close request details"
              onClick={onClose}
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-95 motion-reduce:transition-none"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto bg-(--tanaw-surface-raised) p-6">
            {isLoading && (
              <TicketDetailSkeleton />
            )}

            {!isLoading && error && (
              <div role="alert" className="tanaw-enter flex items-start gap-2.5 rounded-tanaw-md border border-(--tanaw-danger-line) bg-(--tanaw-danger-surface) px-4 py-3 text-sm font-semibold text-(--tanaw-danger-text)">
                <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            {!isLoading && !error && ticket && (
              <div className="tanaw-enter grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-5">
                  <section className="rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold tracking-wide text-(--tanaw-accent-ink)">{ticket.code}</p>
                        <h4 className="mt-1 font-display text-lg leading-snug font-bold text-(--tanaw-text)">{ticket.title}</h4>
                        <p className="mt-2 text-sm leading-relaxed text-(--tanaw-text-secondary)">{ticket.description}</p>
                      </div>
                      <TicketStatusBadge status={ticket.status} />
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <DetailTile label="Enterprise" value={ticket.enterpriseName ?? ticket.requesterName} />
                    <DetailTile label="Enterprise ID" value={ticket.enterpriseId ?? "Not linked"} mono />
                    <DetailTile label="Group" value={ticket.group} />
                    <DetailTile label="Sent" value={formatTicketTime(ticket.createdAt, timeFormat)} />
                    {ticket.affectedArea ? <DetailTile label="Affected Area" value={ticket.affectedArea} /> : null}
                    {ticket.camera ? <DetailTile label="Camera" value={ticket.camera} /> : null}
                  </section>

                  <section className="rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="flex items-center gap-2 font-display text-base font-bold text-(--tanaw-text)">
                        <Paperclip size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
                        Photos
                      </h4>
                      <span className="text-xs font-semibold text-(--tanaw-text-muted)">{ticket.attachments.length} attached</span>
                    </div>
                    {ticket.attachments.length > 0 ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {ticket.attachments.map((attachment, index) => (
                          <button
                            key={attachment.id ?? `${attachment.fileName}-${index}`}
                            type="button"
                            onClick={() => onPreviewPhoto(attachment)}
                            className="flex items-center gap-3 rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-3 text-left transition-[background-color,border-color] duration-150 ease-tanaw-out hover:border-(--tanaw-interactive-hover-border) hover:bg-(--tanaw-interactive-hover-bg) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
                          >
                            <TicketAttachmentImage attachment={attachment} alt="" className="h-16 w-16 rounded-tanaw-sm object-cover ring-1 ring-(--tanaw-border-soft)" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-(--tanaw-text)">{attachment.fileName}</span>
                              <span className="mt-1 block text-xs text-(--tanaw-text-muted)">{formatFileSize(attachment.sizeBytes)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-tanaw-md border border-dashed border-(--tanaw-control-border) bg-(--tanaw-surface-inset) px-4 py-5 text-sm text-(--tanaw-text-muted)">
                        No photos were attached to this request.
                      </p>
                    )}
                  </section>
                </div>

                <section className="rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-5">
                  <h4 className="flex items-center gap-2 font-display text-base font-bold text-(--tanaw-text)">
                    <MessageSquare size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
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
                    <ConversationItem authorName={ticket.requesterName} authorRole="enterprise" createdAt={ticket.createdAt} message={ticket.description} timeFormat={timeFormat} />
                    {ticket.messages.filter((message) => message.kind !== "status").map((message) => (
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
                      className="tanaw-enter mt-3 w-full rounded-full border border-(--tanaw-success-line) bg-(--tanaw-success-surface) px-3 py-2 text-[0.8125rem] font-semibold text-(--tanaw-success-text) transition-colors duration-150 hover:bg-(--tanaw-interactive-active-bg) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
                    >
                      New message
                    </button>
                  ) : null}
                  {!canReplyToSupportTicket(ticket) ? (
                    <div className="mt-4 rounded-tanaw-md border border-(--tanaw-success-line) bg-(--tanaw-success-surface) px-4 py-3 text-sm font-medium text-(--tanaw-success-text)">
                      {canReopenSupportTicket(ticket) ? "This request is resolved, so the conversation is closed. Reopen it if the problem came back." : `This request is ${ticket.status.toLowerCase()}. The conversation is closed.`}
                      {canReopenSupportTicket(ticket) && (
                        <button
                          type="button"
                          disabled={isReopening}
                          onClick={() => void handleReopen()}
                          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-4 text-sm font-semibold text-(--tanaw-accent-ink) transition-[background-color,border-color,translate,scale] duration-150 ease-tanaw-out hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.99] disabled:opacity-70"
                        >
                          {isReopening ? <RefreshCw size={15} className="animate-spin" /> : null}
                          Reopen request
                        </button>
                      )}
                    </div>
                  ) : (
                    <form className="mt-4 space-y-3 border-t border-(--tanaw-border-soft) pt-4" onSubmit={handleReply}>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">Reply in TANAW</span>
                        <textarea
                          value={reply}
                          maxLength={2000}
                          onChange={(event) => {
                            setReply(event.target.value);
                            if (replyError) setReplyError("");
                          }}
                          className="min-h-24 w-full resize-y rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3.5 py-3 text-sm text-(--tanaw-text) transition-[border-color,box-shadow] duration-150 ease-tanaw-out outline-none placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15"
                          placeholder="Add information or respond to IT"
                        />
                      </label>
                      {replyError ? <p role="alert" className="text-[0.8125rem] font-semibold text-(--tanaw-error)">{replyError}</p> : null}
                      <button
                        type="submit"
                        disabled={isReplying}
                        className="inline-flex h-10.5 w-full items-center justify-center gap-2 rounded-tanaw-md bg-(--tanaw-action) px-4 text-sm font-semibold text-(--tanaw-on-action) shadow-tanaw-resting transition-[background-color,box-shadow,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-action-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
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
  const panelRef = useRef<HTMLElement>(null);
  useDialogFocus(panelRef, onClose);
  return (
    <ModalPortal>
      <div className="tanaw-backdrop-enter fixed inset-0 z-1200 flex items-center justify-center overflow-y-auto bg-[rgb(3_20_12/0.66)] p-4 backdrop-blur-[6px]" onPointerDown={onClose}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label={photo.fileName}
          ref={panelRef}
          tabIndex={-1}
          className="tanaw-dialog-enter my-auto max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-hidden rounded-tanaw-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) shadow-tanaw-raised outline-none"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div aria-hidden="true" className="h-1 bg-(image:--tanaw-metric-thread)" />
          <header className="relative flex items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-6 pt-5 pb-4">
            <div className="min-w-0">
              <p className="mb-1 font-mono text-xs font-semibold tracking-[0.12em] text-(--tanaw-gold-ink) uppercase">Ticket Photo</p>
              <h3 className="truncate font-display text-xl leading-tight font-bold text-(--tanaw-text)">{photo.fileName}</h3>
            </div>
            <button
              type="button"
              aria-label="Close photo preview"
              onClick={onClose}
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-95 motion-reduce:transition-none"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto bg-(--tanaw-surface-raised) p-5">
            <div className="rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-3">
              <TicketAttachmentImage attachment={photo} alt={photo.fileName} className="max-h-[70vh] min-h-72 w-full rounded-tanaw-md object-contain" showError />
            </div>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function TicketAttachmentImage({ alt, attachment, className, showError = false }: { alt: string; attachment: SupportTicketAttachment; className: string; showError?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);

  if (!error && (isLoading || !imageUrl)) return <Skeleton className={className} label="Loading image" />;

  if (error || !imageUrl) {
    return (
      <div
        className={`${className} flex items-center justify-center border border-dashed border-(--tanaw-control-border) bg-(--tanaw-surface-inset) text-center text-(--tanaw-text-muted)`}
      >
        <span className="flex max-w-full flex-col items-center gap-2 px-3">
          <ImageIcon size={showError ? 30 : 18} aria-hidden="true" />
          {showError && <span className="text-sm font-semibold">{error}</span>}
        </span>
      </div>
    );
  }

  return <img src={imageUrl} alt={alt} className={`tanaw-enter ${className}`} />;
}

function DetailTile({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface) px-4 py-3">
      <p className="text-xs font-semibold text-(--tanaw-text-muted)">{label}</p>
      <p className={`mt-1 text-sm font-semibold wrap-break-word text-(--tanaw-text) ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function ConversationItem({ authorName, authorRole, createdAt, message, timeFormat }: { authorName: string; authorRole: string; createdAt: string; message: string; timeFormat: SystemTimeFormat }) {
  const isEnterprise = authorRole === "enterprise";
  return (
    <article
      className={`rounded-tanaw-md border p-3.5 ${
        isEnterprise ? "border-(--tanaw-success-line) bg-(--tanaw-success-surface)" : "border-(--tanaw-info-line) bg-(--tanaw-information-surface)"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-semibold text-(--tanaw-text)">{authorName}</p>
        <p className="text-xs text-(--tanaw-text-muted)">
          {authorRoleLabel(authorRole)} / {formatTicketTime(createdAt, timeFormat)}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-(--tanaw-text-secondary)">{message}</p>
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

/** The request in outline while its latest replies load: summary, detail tiles and conversation. */
function TicketDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading the request" className="tanaw-skeleton-screen grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <div className="space-y-3 rounded-tanaw-lg border border-(--tanaw-border-soft) p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2 rounded-tanaw-md border border-(--tanaw-border-soft) px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-tanaw-lg border border-(--tanaw-border-soft) p-5">
        <Skeleton className="h-5 w-36" />
        {[88, 70, 80].map((width, index) => (
          <div key={index} className="space-y-2 rounded-tanaw-md border border-(--tanaw-border-soft) p-3.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
