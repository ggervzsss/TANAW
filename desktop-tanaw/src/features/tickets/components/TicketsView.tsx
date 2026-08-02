import { type ChangeEvent, type DragEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, LifeBuoy, Paperclip, RefreshCw, Send, TicketCheck, UploadCloud, X } from "lucide-react";
import { Card } from "../../../components/Card";
import { ExpandableText } from "../../../components/ExpandableText";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { useRealtimeEvent } from "../../realtime/realtime-context";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { focusFirstInvalidField } from "../../../utils/focus-first-invalid-field";
import { useScopedPageState } from "../../../hooks/useScopedPageState";
import {
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  sortSupportTickets,
  type SupportTicket,
  type SupportTicketAttachment,
  type SupportTicketDetail,
  type SupportTicketPriority,
  type SupportTicketSort,
} from "../services/tickets";
import { PhotoPreviewModal, TicketDetailModal } from "./TicketDetailModal";
import { TicketBadge, TicketStatusBadge } from "./TicketPresentation";
import { formatFileSize, formatTicketTime, getTicketRequestError } from "../utils/ticket-presentation";
import {
  type TicketFormErrors,
  type TicketFormField,
  type TicketFormState,
  isSupportTicketCategory,
  isSupportTicketPriority,
  ticketFormFieldOrder,
  validateTicketForm,
} from "./ticket-form-validation";
import { clearHiddenTicketFields, getSupportTicketCategoryConfig, supportTicketCategories, ticketCategoryPayloadFields } from "./ticket-category-config";

const priorities: SupportTicketPriority[] = ["Normal", "High", "Urgent", "Low"];
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxPhotoBytes = 5 * 1024 * 1024;
const maxPhotoCount = 5;
const EMPTY_PHOTOS: SupportTicketAttachment[] = [];

const emptyForm: TicketFormState = {
  affectedArea: "",
  cameraNode: "",
  category: "Camera Issue",
  description: "",
  priority: "Normal",
  subject: "",
};
const initialTicketSort: SupportTicketSort = "recommended";
const ticketSortOptions: [SupportTicketSort, string][] = [
  ["recommended", "Recommended"],
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["priority-high", "Priority: Urgent to Low"],
  ["priority-low", "Priority: Low to Urgent"],
  ["status", "Status"],
  ["recently-updated", "Recently updated"],
];

export function TicketsView() {
  const user = useAuthStore((state) => state.user);
  const { timeFormat } = useSystemDisplayPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [form, setForm, clearFormDraft] = useScopedPageState({
    initialValue: emptyForm,
    isValid: isTicketFormState,
    namespace: "support-ticket-draft",
    version: 1,
  });
  const [photos, setPhotos, clearPhotoDraft] = useScopedPageState({
    initialValue: EMPTY_PHOTOS,
    isValid: isTicketPhotoDraft,
    namespace: "support-ticket-photos",
    storage: "memory",
    version: 1,
  });
  const [ticketSort, setTicketSort] = useScopedPageState({
    initialValue: initialTicketSort,
    isValid: isSupportTicketSort,
    namespace: "support-ticket-sort",
    version: 1,
  });
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
  const sortedTickets = useMemo(() => sortSupportTickets(tickets, ticketSort), [ticketSort, tickets]);
  const categoryFieldConfig = isSupportTicketCategory(form.category) ? getSupportTicketCategoryConfig(form.category) : null;

  const refreshTickets = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setTickets(await listSupportTickets());
    } catch (requestError) {
      setError(getTicketRequestError(requestError, "Unable to load support tickets."));
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
          setSelectedTicketError(getTicketRequestError(requestError, "Unable to load ticket details."));
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
      window.requestAnimationFrame(() =>
        focusFirstInvalidField(
          formElement,
          ticketFormFieldOrder.filter((field) => nextErrors[field]),
        ),
      );
      return;
    }
    if (!isSupportTicketCategory(form.category) || !isSupportTicketPriority(form.priority)) return;

    setIsSubmitting(true);
    setError("");
    try {
      const categoryFields = ticketCategoryPayloadFields(form.category, form);
      const ticket = await createSupportTicket({
        ...categoryFields,
        category: form.category,
        description: form.description.trim(),
        priority: form.priority,
        subject: form.subject.trim(),
        attachments: photos,
      });
      setTickets((current) => [ticket, ...current.filter((item) => item.id !== ticket.id)]);
      clearFormDraft();
      clearPhotoDraft();
      setFieldErrors({});
      setPhotoError("");
      notifySuccess(`Ticket ${ticket.code} submitted.`);
    } catch (requestError) {
      const message = getTicketRequestError(requestError, "Unable to submit support ticket.");
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
                options={[...supportTicketCategories]}
                onChange={(value) => {
                  setError("");
                  clearFieldError("category");
                  if (!isSupportTicketCategory(value)) {
                    setForm((current) => ({ ...current, category: value }));
                    return;
                  }
                  setFieldErrors((current) => ({
                    ...current,
                    affectedArea: undefined,
                    category: undefined,
                  }));
                  setForm((current) => ({
                    ...current,
                    ...clearHiddenTicketFields(value, current),
                    category: value,
                  }));
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

            {categoryFieldConfig && (categoryFieldConfig.showAffectedArea || categoryFieldConfig.showCamera) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-live="polite">
                {categoryFieldConfig.showAffectedArea && (
                  <InputField
                    name="affectedArea"
                    label={categoryFieldConfig.affectedAreaRequired ? "Affected Area *" : "Affected Area"}
                    value={form.affectedArea}
                    placeholder="Lobby, service area, or workflow"
                    onChange={(value) => {
                      clearFieldError("affectedArea");
                      setForm((current) => ({ ...current, affectedArea: value }));
                    }}
                    error={fieldErrors.affectedArea}
                  />
                )}
                {categoryFieldConfig.showCamera && (
                  <InputField
                    name="cameraNode"
                    label="Camera"
                    value={form.cameraNode}
                    placeholder="Optional camera name"
                    onChange={(value) => setForm((current) => ({ ...current, cameraNode: value }))}
                  />
                )}
              </div>
            )}

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
                <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-300">
                  {photos.length}/{maxPhotoCount} photos
                </span>
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
          <TicketPanelHeader
            icon={<TicketCheck size={20} />}
            title="Support Requests"
            subtitle={`${openTicketCount} open or in-review ticket${openTicketCount === 1 ? "" : "s"}`}
            actions={
              <div className="w-full sm:w-60">
                <span className="mb-1 block text-[10px] font-bold tracking-wider text-gray-500 uppercase dark:text-slate-300">Sort tickets</span>
                <SelectDropdown value={ticketSort} onChange={(value) => setTicketSort(value as SupportTicketSort)} options={ticketSortOptions} ariaLabel="Sort tickets" size="compact" />
              </div>
            }
          />

          {tickets.length > 0 ? (
            <div className="max-h-152 divide-y divide-gray-100 overflow-y-auto bg-white dark:divide-slate-700 dark:bg-[#121c31]">
              {sortedTickets.map((ticket) => (
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
                        twoLines
                      />
                    </div>
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-black tracking-wide uppercase">
                    <TicketBadge tone="info">{ticket.category}</TicketBadge>
                    <TicketBadge tone={ticket.priority === "Urgent" || ticket.priority === "High" ? "warning" : "neutral"}>{ticket.priority}</TicketBadge>
                    {ticket.affectedArea && <TicketBadge tone="neutral">{ticket.affectedArea}</TicketBadge>}
                    {ticket.cameraNode && <TicketBadge tone="neutral">{ticket.cameraNode}</TicketBadge>}
                    {(ticket.attachments?.length ?? 0) > 0 && (
                      <TicketBadge tone="info">
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={11} />
                          {ticket.attachments.length} photo{ticket.attachments.length === 1 ? "" : "s"}
                        </span>
                      </TicketBadge>
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

      {previewPhoto && <PhotoPreviewModal photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />}
    </div>
  );
}

type TicketPanelHeaderProps = {
  actions?: ReactNode;
  icon: ReactNode;
  subtitle: string;
  title: string;
};

function TicketPanelHeader({ actions, icon, subtitle, title }: TicketPanelHeaderProps) {
  return (
    <div className="enterprise-ticket-panel-header border-b border-emerald-100 px-6 py-5 dark:border-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-300/20">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-black tracking-wide text-[#111827] uppercase dark:text-white">{title}</h3>
            <p className="mt-1 text-xs font-semibold text-gray-500 dark:text-slate-200">{subtitle}</p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  );
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
      <SelectDropdown value={value} onChange={onChange} options={options} ariaLabel={label} ariaInvalid={Boolean(error)} ariaDescribedBy={error ? errorId : undefined} focusOnFormError />
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

function isTicketFormState(value: unknown): value is TicketFormState {
  if (!value || typeof value !== "object") return false;
  const form = value as Partial<TicketFormState>;
  return (
    typeof form.affectedArea === "string" &&
    typeof form.cameraNode === "string" &&
    typeof form.category === "string" &&
    isSupportTicketCategory(form.category) &&
    typeof form.description === "string" &&
    typeof form.priority === "string" &&
    isSupportTicketPriority(form.priority) &&
    typeof form.subject === "string"
  );
}

function isTicketPhotoDraft(value: unknown): value is SupportTicketAttachment[] {
  return (
    Array.isArray(value) &&
    value.length <= maxPhotoCount &&
    value.every((photo) =>
      Boolean(
        photo &&
        typeof photo === "object" &&
        "dataUrl" in photo &&
        typeof photo.dataUrl === "string" &&
        photo.dataUrl.startsWith("data:image/") &&
        "fileName" in photo &&
        typeof photo.fileName === "string" &&
        "sizeBytes" in photo &&
        typeof photo.sizeBytes === "number",
      ),
    )
  );
}

function isSupportTicketSort(value: unknown): value is SupportTicketSort {
  return ticketSortOptions.some(([sort]) => sort === value);
}
