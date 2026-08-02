import { type ChangeEvent, type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "../../login/stores/auth-store";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { useRealtimeEvent } from "../../realtime/realtime-context";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { focusFirstInvalidField } from "../../../utils/focus-first-invalid-field";
import { useScopedPageState } from "../../../hooks/useScopedPageState";
import { createSupportTicket, getSupportTicket, listSupportTickets, sortSupportTickets, type SupportTicket, type SupportTicketAttachment, type SupportTicketDetail } from "../services/tickets";
import { getTicketRequestError } from "../utils/ticket-presentation";
import { type TicketFormErrors, type TicketFormField, isSupportTicketCategory, isSupportTicketPriority, ticketFormFieldOrder, validateTicketForm } from "../components/ticket-form-validation";
import { getSupportTicketCategoryConfig, ticketCategoryPayloadFields } from "../components/ticket-category-config";
import { emptyTicketForm, emptyTicketPhotos, initialTicketSort, isSupportTicketSort, isTicketFormState, isTicketPhotoDraft, maxTicketPhotoCount, readTicketPhoto } from "../model/ticket-draft";

export function useTicketsWorkspace() {
  const user = useAuthStore((state) => state.user);
  const { timeFormat } = useSystemDisplayPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [form, setForm, clearFormDraft] = useScopedPageState({
    initialValue: emptyTicketForm,
    isValid: isTicketFormState,
    namespace: "support-ticket-draft",
    version: 1,
  });
  const [photos, setPhotos, clearPhotoDraft] = useScopedPageState({
    initialValue: emptyTicketPhotos,
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

    if (photos.length + files.length > maxTicketPhotoCount) {
      showPhotoError(`You can attach up to ${maxTicketPhotoCount} photos.`);
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

  return {
    categoryFieldConfig,
    clearFieldError,
    enterpriseName,
    error,
    fieldErrors,
    fileInputRef,
    form,
    formRef,
    handleDrop,
    handlePhotoInputChange,
    handleSubmit,
    isDetailLoading,
    isDragActive,
    isLoading,
    isSubmitting,
    openTicketCount,
    photoError,
    photos,
    previewPhoto,
    selectedTicket,
    selectedTicketError,
    selectedTicketId,
    setError,
    setFieldErrors,
    setForm,
    setIsDragActive,
    setPhotos,
    setPreviewPhoto,
    setSelectedTicket,
    setSelectedTicketId,
    setTicketSort,
    setTickets,
    sortedTickets,
    ticketSort,
    tickets,
    timeFormat,
  };
}
