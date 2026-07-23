import { type ChangeEvent, type DragEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, LifeBuoy, MessageSquare, Paperclip, RefreshCw, Send, TicketCheck, UploadCloud, X } from "lucide-react";
import { Card } from "../../../components/Card";
import { ExpandableText } from "../../../components/ExpandableText";
import { ModalPortal } from "../../../components/ModalPortal";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { useRealtimeEvent } from "../../realtime/realtime-context";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";
import { focusFirstInvalidField } from "../../../utils/focus-first-invalid-field";
import {
  createSupportTicket,
  canReplyToSupportTicket,
  getSupportTicket,
  getSupportTicketAttachmentUrl,
  listSupportTickets,
  replyToSupportTicket,
  type SupportTicket,
  type SupportTicketAttachment,
  type SupportTicketCategory,
  type SupportTicketDetail,
  type SupportTicketPriority,
} from "../services/tickets";
import {
  type TicketFormErrors,
  type TicketFormField,
  type TicketFormState,
  isSupportTicketCategory,
  isSupportTicketPriority,
  ticketFormFieldOrder,
  validateTicketForm,
} from "./ticket-form-validation";

const categories: SupportTicketCategory[] = ["Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"];
const priorities: SupportTicketPriority[] = ["Normal", "High", "Urgent", "Low"];
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxPhotoBytes = 5 * 1024 * 1024;
const maxPhotoCount = 5;

const emptyForm: TicketFormState = {
  affectedArea: "",
  cameraNode: "",
  category: "Camera Issue",
  description: "",
  priority: "Normal",
  subject: "",
};

export function TicketsView() {
  const user = useAuthStore((state) => state.user);
  const { timeFormat } = useSystemDisplayPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [form, setForm] = useState<TicketFormState>(emptyForm);
  const [photos, setPhotos] = useState<SupportTicketAttachment[]>([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<TicketFormErrors>({});
  const [photoError, setPhotoError] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDetail | null>(null);
  const [selectedTicketError, setSelectedTicketError] = useState("");
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<SupportTicketAttachment | null>(null);
  const enterpriseName = user?.enterpriseName ?? user?.displayName ?? "Enterprise Account";
  const openTicketCount = useMemo(() => tickets.filter((ticket) => ticket.status !== "Resolved").length, [tickets]);

  const refreshTickets = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setTickets(await listSupportTickets());
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Unable to load support tickets."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTickets();
  }, [refreshTickets]);

  useRealtimeEvent((event) => {
    if (!event.event_type.startsWith("support_ticket.")) return;
    void listSupportTickets()
      .then(setTickets)
      .catch(() => undefined);
    if (selectedTicketId && (!event.scope.ticket_id || event.scope.ticket_id === selectedTicketId)) {
      void getSupportTicket(selectedTicketId)
        .then(setSelectedTicket)
        .catch(() => undefined);
    }
  });

  useEffect(() => {
    if (!selectedTicketId) {
      setSelectedTicket(null);
      setSelectedTicketError("");
      return undefined;
    }

    let disposed = false;
    setIsDetailLoading(true);
    setSelectedTicketError("");
    void getSupportTicket(selectedTicketId)
      .then((ticket) => {
        if (!disposed) setSelectedTicket(ticket);
      })
      .catch((requestError) => {
        if (!disposed) {
          setSelectedTicket(null);
          setSelectedTicketError(getRequestErrorMessage(requestError, "Unable to load ticket details."));
        }
      })
      .finally(() => {
        if (!disposed) setIsDetailLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [selectedTicketId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const nextErrors = validateTicketForm(form);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError("");
      notifyError("Please correct the highlighted ticket fields.");
      window.requestAnimationFrame(() => focusFirstInvalidField(formElement, ticketFormFieldOrder.filter((field) => nextErrors[field])));
      return;
    }
    if (!isSupportTicketCategory(form.category) || !isSupportTicketPriority(form.priority)) return;

    setIsSubmitting(true);
    setError("");
    try {
      const ticket = await createSupportTicket({
        affectedArea: form.affectedArea.trim(),
        cameraNode: trimOptional(form.cameraNode),
        category: form.category,
        description: form.description.trim(),
        priority: form.priority,
        subject: form.subject.trim(),
        attachments: photos,
      });
      setTickets((current) => [ticket, ...current.filter((item) => item.id !== ticket.id)]);
      setForm(emptyForm);
      setPhotos([]);
      setFieldErrors({});
      setPhotoError("");
      notifySuccess(`Ticket ${ticket.code} submitted.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, "Unable to submit support ticket.");
      setError(message);
      notifyError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSelectedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    if (photos.length + files.length > maxPhotoCount) {
      showPhotoError(`You can attach up to ${maxPhotoCount} photos.`);
      return;
    }

    try {
      const nextPhotos = await Promise.all(files.map(readTicketPhoto));
      setPhotos((current) => [...current, ...nextPhotos]);
      setPhotoError("");
    } catch (fileError) {
      showPhotoError(fileError instanceof Error ? fileError.message : "Unable to attach photo.");
    }
  }

  function handlePhotoInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleSelectedFiles(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragActive(false);
    void handleSelectedFiles(event.dataTransfer.files);
  }

  function clearFieldError(field: TicketFormField) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function showPhotoError(message: string) {
    setPhotoError(message);
    setError("");
    notifyError(message);
    const formElement = formRef.current;
    if (formElement) window.requestAnimationFrame(() => focusFirstInvalidField(formElement, ["attachments"]));
  }

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-330 space-y-6 pt-2 font-['Inter'] duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise Support</p>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">Support Tickets</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-slate-200">
            Submit camera, reporting, maintenance, or account concerns for {enterpriseName}. Admin and IT personnel will be notified.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-950/35 dark:text-red-100">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_18px_44px_rgba(15,23,42,0.07)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(15,23,42,0.11)] dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_22px_54px_rgba(0,0,0,0.36)]">
          <TicketPanelHeader icon={<LifeBuoy size={18} />} title="New Ticket" subtitle="Provide enough detail for remote review or on-site action." />

          <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4 bg-white p-6 dark:bg-[#121c31]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                name="category"
                label="Category"
                value={form.category}
                options={categories}
                onChange={(value) => {
                  setError("");
                  clearFieldError("category");
                  setForm((current) => ({ ...current, category: value }));
                }}
                error={fieldErrors.category}
              />
              <SelectField
                name="priority"
                label="Priority"
                value={form.priority}
                options={priorities}
                onChange={(value) => {
                  setError("");
                  clearFieldError("priority");
                  setForm((current) => ({ ...current, priority: value }));
                }}
                error={fieldErrors.priority}
              />
            </div>

            <InputField
              name="subject"
              label="Subject"
              value={form.subject}
              placeholder="Brief summary of the issue"
              onChange={(value) => {
                setError("");
                clearFieldError("subject");
                setForm((current) => ({ ...current, subject: value }));
              }}
              error={fieldErrors.subject}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InputField
                name="affectedArea"
                label="Affected Area"
                value={form.affectedArea}
                placeholder="Lobby, reports, account"
                onChange={(value) => {
                  clearFieldError("affectedArea");
                  setForm((current) => ({ ...current, affectedArea: value }));
                }}
                error={fieldErrors.affectedArea}
              />
              <InputField name="cameraNode" label="Camera" value={form.cameraNode} placeholder="Optional camera name" onChange={(value) => setForm((current) => ({ ...current, cameraNode: value }))} />
            </div>

            <label data-field-name="description" className="block scroll-mt-28">
              <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">Description</span>
              <textarea
                value={form.description}
                onChange={(event) => {
                  setError("");
                  clearFieldError("description");
                  setForm((current) => ({ ...current, description: event.target.value }));
                }}
                rows={6}
                placeholder="Describe what happened, when it started, and any affected workflows."
                className={fieldClassName("resize-none")}
                aria-invalid={Boolean(fieldErrors.description)}
                aria-describedby={fieldErrors.description ? "ticket-description-error" : undefined}
                data-form-error-focus
              />
              {fieldErrors.description ? <FieldError id="ticket-description-error" message={fieldErrors.description} /> : null}
            </label>

            <div data-field-name="attachments" className="scroll-mt-28">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">Attach Photos</span>
                <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-300">{photos.length}/{maxPhotoCount} photos</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" multiple onChange={handlePhotoInputChange} className="sr-only" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={handleDrop}
                aria-invalid={Boolean(photoError)}
                aria-describedby={photoError ? "ticket-attachments-error" : undefined}
                data-form-error-focus
                className={`flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center transition ${
                  isDragActive
                    ? "border-[#065f46] bg-emerald-50 text-[#065f46] dark:border-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-100"
                    : "border-gray-200 bg-gray-50 text-gray-500 hover:border-[#065f46]/50 hover:bg-emerald-50/70 dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-200 dark:hover:border-emerald-300/50 dark:hover:bg-emerald-500/10"
                }`}
              >
                <UploadCloud size={22} />
                <span className="mt-2 text-sm font-bold">Upload or drop photos</span>
                <span className="mt-1 text-xs font-medium">PNG, JPG, JPEG, or WebP. Max 5 MB each.</span>
              </button>
              {photoError ? <FieldError id="ticket-attachments-error" message={photoError} /> : null}
              {photos.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {photos.map((photo, index) => (
                    <div key={`${photo.fileName}-${index}`} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm dark:border-slate-600 dark:bg-[#0f172a]">
                      <img src={photo.dataUrl} alt="" className="h-12 w-12 rounded-xl object-cover ring-1 ring-gray-200 dark:ring-slate-700" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-[#111827] dark:text-slate-100">{photo.fileName}</p>
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-300">{formatFileSize(photo.sizeBytes)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                        className="rounded-full p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-200"
                        aria-label={`Remove ${photo.fileName}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#065f46] px-5 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(6,95,70,0.2)] transition hover:-translate-y-0.5 hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-[#065f46]/70"
            >
              {isSubmitting ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
              {isSubmitting ? "Submitting..." : "Submit Ticket"}
            </button>
          </form>
        </Card>

        <Card className="overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_18px_44px_rgba(15,23,42,0.07)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(15,23,42,0.11)] dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_22px_54px_rgba(0,0,0,0.36)]">
          <TicketPanelHeader icon={<TicketCheck size={20} />} title="Support Requests" subtitle={`${openTicketCount} open or in-review ticket${openTicketCount === 1 ? "" : "s"}`} />

          {tickets.length > 0 ? (
            <div className="max-h-152 divide-y divide-gray-100 overflow-y-auto bg-white dark:divide-slate-700 dark:bg-[#121c31]">
              {tickets.map((ticket) => (
                <article
                  key={ticket.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedTicketId(ticket.id);
                    }
                  }}
                  className="cursor-pointer p-5 transition duration-200 hover:bg-emerald-50/50 focus:bg-emerald-50/50 focus:outline-none dark:bg-[#121c31] dark:hover:bg-[#18243a] dark:focus:bg-[#18243a]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-[#065f46] dark:text-emerald-200">{ticket.code}</p>
                      <ExpandableText
                        primary={ticket.subject}
                        secondary={ticket.description}
                        ariaLabel="ticket subject and description"
                        className="mt-1 text-sm font-black text-[#111827] dark:text-slate-100"
                        secondaryClassName="text-xs leading-relaxed text-gray-500 dark:text-slate-300"
                        threshold={72}
                        twoLines
                      />
                    </div>
                    <StatusBadge status={ticket.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-black tracking-wide uppercase">
                    <Badge tone="info">{ticket.category}</Badge>
                    <Badge tone={ticket.priority === "Urgent" || ticket.priority === "High" ? "warning" : "neutral"}>{ticket.priority}</Badge>
                    {ticket.affectedArea && <Badge tone="neutral">{ticket.affectedArea}</Badge>}
                    {ticket.cameraNode && <Badge tone="neutral">{ticket.cameraNode}</Badge>}
                    {(ticket.attachments?.length ?? 0) > 0 && (
                      <Badge tone="info">
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={11} />
                          {ticket.attachments.length} photo{ticket.attachments.length === 1 ? "" : "s"}
                        </span>
                      </Badge>
                    )}
                    <span className="ml-auto text-gray-400 dark:text-slate-300">{formatTicketTime(ticket.createdAt, timeFormat)}</span>
                    <span className="inline-flex items-center gap-1 text-[#065f46] dark:text-emerald-200">
                      <Eye size={11} />
                      Inspect
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-96 flex-col items-center justify-center bg-white px-6 py-14 text-center dark:bg-[#121c31]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-300/20">
                {isLoading ? <RefreshCw size={22} className="animate-spin" /> : <CheckCircle2 size={22} />}
              </div>
              <p className="mt-4 text-sm font-black text-[#111827] dark:text-slate-100">{isLoading ? "Loading tickets" : "No support tickets"}</p>
              <p className="mt-1 max-w-80 text-xs leading-relaxed text-gray-500 dark:text-slate-300">Submitted enterprise tickets will appear here with their review status.</p>
            </div>
          )}
        </Card>
      </div>

      {selectedTicketId && (
        <TicketDetailModal
          error={selectedTicketError}
          isLoading={isDetailLoading}
          ticket={selectedTicket}
          timeFormat={timeFormat}
          onClose={() => {
            setSelectedTicketId(null);
            setPreviewPhoto(null);
          }}
          onPreviewPhoto={setPreviewPhoto}
          onTicketUpdated={(ticket) => {
            setSelectedTicket(ticket);
            setTickets((current) => current.map((item) => (item.id === ticket.id ? ticket : item)));
          }}
        />
      )}

      {previewPhoto && (
        <PhotoPreviewModal photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />
      )}
    </div>
  );
}

type TicketPanelHeaderProps = {
  icon: ReactNode;
  subtitle: string;
  title: string;
};

function TicketPanelHeader({ icon, subtitle, title }: TicketPanelHeaderProps) {
  return (
    <div className="enterprise-ticket-panel-header border-b border-emerald-100 px-6 py-5 dark:border-slate-600">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-300/20">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-black tracking-wide text-[#111827] uppercase dark:text-white">{title}</h3>
          <p className="mt-1 text-xs font-semibold text-gray-500 dark:text-slate-200">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

type TicketDetailModalProps = {
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onPreviewPhoto: (photo: SupportTicketAttachment) => void;
  onTicketUpdated: (ticket: SupportTicketDetail) => void;
  ticket: SupportTicketDetail | null;
  timeFormat: SystemTimeFormat;
};

function TicketDetailModal({ error, isLoading, onClose, onPreviewPhoto, onTicketUpdated, ticket, timeFormat }: TicketDetailModalProps) {
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
      const messageText = getRequestErrorMessage(requestError, "Unable to send the ticket reply.");
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
              <p className="mb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700/80 uppercase dark:text-emerald-200/90">
                {ticket?.code ?? "Support Ticket"}
              </p>
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
                        <StatusBadge status={ticket.status} />
                        <Badge tone={ticket.priority === "Urgent" || ticket.priority === "High" ? "warning" : "neutral"}>{ticket.priority}</Badge>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <DetailTile label="Enterprise" value={ticket.enterpriseName} />
                    <DetailTile label="Enterprise ID" value={ticket.enterpriseId} mono />
                    <DetailTile label="Category" value={ticket.category} />
                    <DetailTile label="Submitted" value={formatTicketTime(ticket.createdAt, timeFormat)} />
                    <DetailTile label="Affected Area" value={ticket.affectedArea ?? "Not specified"} />
                    <DetailTile label="Camera" value={ticket.cameraNode ?? "Not specified"} />
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
                            <img src={getSupportTicketAttachmentUrl(attachment)} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-gray-200 dark:ring-slate-700" />
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
                      <ConversationItem key={message.id} authorName={message.authorName} authorRole={message.authorRole} createdAt={message.createdAt} message={message.message} timeFormat={timeFormat} />
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
                          className="min-h-24 w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-[#111827] outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100 dark:focus:border-emerald-300/40"
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

function PhotoPreviewModal({ onClose, photo }: { onClose: () => void; photo: SupportTicketAttachment }) {
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
              <img src={getSupportTicketAttachmentUrl(photo)} alt={photo.fileName} className="max-h-[70vh] w-full rounded-2xl object-contain" />
            </div>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function DetailTile({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm dark:border-slate-600 dark:bg-[#0f172a]">
      <p className="text-[10px] font-black tracking-[0.16em] text-gray-500 uppercase dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold wrap-break-word text-[#111827] dark:text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function ConversationItem({
  authorName,
  authorRole,
  createdAt,
  message,
  timeFormat,
}: {
  authorName: string;
  authorRole: string;
  createdAt: string;
  message: string;
  timeFormat: SystemTimeFormat;
}) {
  const isEnterprise = authorRole === "enterprise";
  return (
    <article
      className={`rounded-2xl border p-3 ${
        isEnterprise
          ? "border-emerald-100 bg-emerald-50/70 dark:border-emerald-300/20 dark:bg-emerald-500/10"
          : "border-blue-100 bg-blue-50/70 dark:border-blue-300/20 dark:bg-blue-500/10"
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

type InputFieldProps = {
  error?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

function InputField({ error, label, name, onChange, placeholder, value }: InputFieldProps) {
  const errorId = `ticket-${name}-error`;
  return (
    <label data-field-name={name} className="block scroll-mt-28">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">{label}</span>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={fieldClassName()}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        data-form-error-focus
      />
      {error ? <FieldError id={errorId} message={error} /> : null}
    </label>
  );
}

type SelectFieldProps = {
  error?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
};

function SelectField({ error, label, name, onChange, options, value }: SelectFieldProps) {
  const errorId = `ticket-${name}-error`;
  return (
    <div data-field-name={name} className="block scroll-mt-28">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">{label}</span>
      <SelectDropdown
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel={label}
        ariaInvalid={Boolean(error)}
        ariaDescribedBy={error ? errorId : undefined}
        focusOnFormError
      />
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-red-700 dark:text-red-200">
      {message}
    </p>
  );
}

function StatusBadge({ status }: { status: SupportTicket["status"] }) {
  const className =
    status === "Resolved"
      ? "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200"
      : status === "In Review"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100"
        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-300/20 dark:bg-blue-500/10 dark:text-blue-100";

  return <span className={`rounded-full border px-3 py-1 text-[10px] font-black tracking-wide uppercase ${className}`}>{status}</span>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "info" | "neutral" | "warning" }) {
  const className =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100"
      : tone === "info"
        ? "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200"
        : "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-200";

  return <span className={`rounded-full border px-2.5 py-1 ${className}`}>{children}</span>;
}

function fieldClassName(extra = "") {
  return `w-full rounded-2xl border border-gray-200 bg-white p-3.5 text-sm text-[#111827] shadow-sm outline-none transition-colors focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 dark:border-slate-600 dark:bg-[#0f172a] dark:text-white dark:placeholder:text-slate-400 dark:focus:border-emerald-300/70 ${extra}`;
}

async function readTicketPhoto(file: File): Promise<SupportTicketAttachment> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedImageTypes.has(file.type) || !allowedImageExtensions.has(extension)) {
    throw new Error("Only image files are allowed.");
  }
  if (file.size > maxPhotoBytes) {
    throw new Error("Each photo must be under 5 MB.");
  }

  const dataUrl = await readAsDataUrl(file);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error("Only image files are allowed.");
  }

  return {
    dataUrl,
    fileName: file.name.replace(/\\/g, "/").split("/").pop() || "ticket-photo",
    mediaType: file.type as SupportTicketAttachment["mediaType"],
    sizeBytes: file.size,
  };
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read image file."));
      }
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function trimOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatTicketTime(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    const detail = response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail && "message" in detail && typeof detail.message === "string") return detail.message;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown };
      if (typeof first.msg === "string") return first.msg;
    }
  }
  return fallback;
}
