import { AlertCircle, CheckCircle2, Eye, LifeBuoy, Paperclip, RefreshCw, Send, TicketCheck, UploadCloud, X } from "lucide-react";
import { Skeleton } from "../../../ui-kit";
import { ExpandableText } from "../../../components/ExpandableText";
import { SelectDropdown } from "../../../components/SelectDropdown";
import type { SupportTicketSort } from "../services/tickets";
import { PhotoPreviewModal, TicketDetailModal } from "./TicketDetailModal";
import { TicketBadge, TicketStatusBadge } from "./TicketPresentation";
import { formatFileSize, formatTicketTime } from "../utils/ticket-presentation";
import { isSupportTicketCategory } from "../model/ticket-form-validation";
import { clearHiddenTicketFields, supportTicketCategories } from "../model/ticket-category-config";
import { InputField, SelectField, TicketFieldError, TicketPanelHeader } from "./TicketFormFields";
import { maxTicketPhotoCount, ticketSortOptions } from "../model/ticket-draft";
import { useTicketsWorkspace } from "../hooks/useTicketsWorkspace";
import { ticketFieldClassName } from "../utils/ticket-form-style";
import { toSentenceCase } from "../../../utils/sentence-case";

export function TicketsView() {
  const {
    categoryFieldConfig,
    clearFieldError,
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
  } = useTicketsWorkspace();

  return (
    <div className="space-y-6 pt-6">
      {error && (
        <div role="alert" className="tanaw-enter flex items-start gap-2.5 rounded-tanaw-md border border-(--tanaw-danger-line) bg-(--tanaw-danger-surface) px-4 py-3 text-sm font-semibold text-(--tanaw-danger-text)">
          <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="tanaw-ticket-layout">
        <section className="tanaw-ticket-pane">
          <TicketPanelHeader icon={<LifeBuoy size={17} aria-hidden="true" />} title="New Request" subtitle="Tell IT what happened, in your own words." />

          <form ref={formRef} onSubmit={handleSubmit} aria-busy={isSubmitting} noValidate className="space-y-5">
            <div className="grid grid-cols-1 gap-4">
              <SelectField
                name="category"
                label="What is it about?"
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
            </div>

            <InputField
              name="subject"
              label="Title"
              value={form.subject}
              placeholder="A short summary, for example: Gate camera keeps disconnecting"
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
              <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">Description</span>
              <textarea
                value={form.description}
                onChange={(event) => {
                  setError("");
                  clearFieldError("description");
                  setForm((current) => ({ ...current, description: event.target.value }));
                }}
                rows={6}
                placeholder="Describe what happened, when it started, and any affected workflows."
                className={ticketFieldClassName("resize-none")}
                aria-invalid={Boolean(fieldErrors.description)}
                aria-describedby={fieldErrors.description ? "ticket-description-error" : undefined}
                data-form-error-focus
              />
              {fieldErrors.description ? <TicketFieldError id="ticket-description-error" message={fieldErrors.description} /> : null}
            </label>

            <div data-field-name="attachments" className="scroll-mt-28">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-(--tanaw-text-secondary)">Attach Photos</span>
                <span className="text-xs font-semibold text-(--tanaw-text-muted) tabular-nums">
                  {photos.length}/{maxTicketPhotoCount} photos
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
                className={`flex w-full flex-col items-center justify-center rounded-tanaw-lg border border-dashed px-4 py-6 text-center transition-[background-color,border-color,color,translate,scale] duration-200 ease-tanaw-out ${
                  isDragActive
                    ? "scale-[1.01] border-(--tanaw-accent-ink) bg-(--tanaw-interactive-selected-bg) text-(--tanaw-accent-ink)"
                    : "border-(--tanaw-control-border) bg-(--tanaw-surface-inset) text-(--tanaw-text-secondary) hover:border-(--tanaw-accent-ink) hover:bg-(--tanaw-interactive-hover-bg) hover:text-(--tanaw-accent-ink)"
                } motion-reduce:scale-100 motion-reduce:transition-none`}
              >
                <UploadCloud size={22} aria-hidden="true" />
                <span className="mt-2 text-sm font-semibold">Upload or drop photos</span>
                <span className="mt-1 text-[0.8125rem] text-(--tanaw-text-muted)">PNG, JPG, JPEG, or WebP. Max 5 MB each.</span>
              </button>
              {photoError ? <TicketFieldError id="ticket-attachments-error" message={photoError} /> : null}
              {photos.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {photos.map((photo, index) => (
                    <div key={`${photo.fileName}-${index}`} className="tanaw-enter flex items-center gap-3 rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-2.5">
                      <img src={photo.dataUrl} alt="" className="h-12 w-12 rounded-tanaw-sm object-cover ring-1 ring-(--tanaw-border-soft)" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8125rem] font-semibold text-(--tanaw-text)">{photo.fileName}</p>
                        <p className="text-xs text-(--tanaw-text-muted)">{formatFileSize(photo.sizeBytes)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-colors duration-150 hover:bg-(--tanaw-danger-surface) hover:text-(--tanaw-danger)"
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
              className="flex h-11 w-full items-center justify-center gap-2 rounded-tanaw-md bg-(--tanaw-action) px-5 text-sm font-semibold text-(--tanaw-on-action) shadow-tanaw-resting transition-[background-color,box-shadow,translate,scale,opacity] duration-150 ease-tanaw-out hover:bg-(--tanaw-action-hover) hover:shadow-[0_6px_16px_rgb(5_91_37/0.22)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {isSubmitting ? <RefreshCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {isSubmitting ? "Sending..." : "Send Request"}
            </button>
          </form>
        </section>

        <section className="tanaw-ticket-pane">
          <TicketPanelHeader
            icon={<TicketCheck size={17} aria-hidden="true" />}
            title="Your Requests"
            subtitle={`${openTicketCount} open request${openTicketCount === 1 ? "" : "s"}`}
            actions={
              <div className="w-full sm:w-60">
                <span className="mb-1 block text-xs font-semibold text-(--tanaw-text-muted)">Sort requests</span>
                <SelectDropdown value={ticketSort} onChange={(value) => setTicketSort(value as SupportTicketSort)} options={ticketSortOptions} ariaLabel="Sort requests" size="compact" />
              </div>
            }
          />

          {tickets.length > 0 ? (
            <div className="tanaw-stagger max-h-152 divide-y divide-(--tanaw-border-soft) overflow-y-auto border-t border-(--tanaw-border-soft)">
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
                  className="cursor-pointer rounded-tanaw-md px-3 py-4 transition-colors duration-150 ease-tanaw-out hover:bg-(--tanaw-interactive-hover-bg) focus-visible:bg-(--tanaw-interactive-hover-bg) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:bg-(--tanaw-interactive-pressed-bg)"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-(--tanaw-accent-ink)">{ticket.code}</p>
                      <ExpandableText
                        primary={ticket.title}
                        secondary={ticket.description}
                        ariaLabel="request title and description"
                        className="mt-1 text-sm font-semibold text-(--tanaw-text)"
                        secondaryClassName="text-[0.8125rem] leading-relaxed text-(--tanaw-text-muted)"
                        twoLines
                      />
                    </div>
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <TicketBadge tone="info">{toSentenceCase(ticket.group)}</TicketBadge>
                    {ticket.affectedArea && <TicketBadge tone="neutral">{ticket.affectedArea}</TicketBadge>}
                    {ticket.camera && <TicketBadge tone="neutral">{ticket.camera}</TicketBadge>}
                    {(ticket.attachments?.length ?? 0) > 0 && (
                      <TicketBadge tone="info">
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} aria-hidden="true" />
                          {ticket.attachments.length} photo{ticket.attachments.length === 1 ? "" : "s"}
                        </span>
                      </TicketBadge>
                    )}
                    <span className="ml-auto text-(--tanaw-text-muted) tabular-nums">{formatTicketTime(ticket.createdAt, timeFormat)}</span>
                    <span className="inline-flex items-center gap-1 text-(--tanaw-accent-ink)">
                      <Eye size={13} aria-hidden="true" />
                      Inspect
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : isLoading ? (
            <TicketListSkeleton />
          ) : (
            <div className="tanaw-enter flex min-h-48 flex-col items-center justify-center border-t border-(--tanaw-border-soft) px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">
                <CheckCircle2 size={22} aria-hidden="true" />
              </div>
              <p className="mt-4 text-sm font-semibold text-(--tanaw-text)">No requests yet</p>
              <p className="mt-1 max-w-80 text-[0.8125rem] leading-relaxed text-(--tanaw-text-muted)">Requests you send to IT appear here with their status and IT’s replies.</p>
            </div>
          )}
        </section>
      </div>

      {selectedTicketId && (
        <TicketDetailModal
          covered={previewPhoto !== null}
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

/** Request rows in outline while the list loads: code, title, a line of description, tags. */
function TicketListSkeleton() {
  return (
    <div role="status" aria-label="Loading requests" className="tanaw-skeleton-screen divide-y divide-(--tanaw-border-soft) border-t border-(--tanaw-border-soft)">
      {[78, 64, 70].map((width, row) => (
        <div key={row} className="space-y-2.5 px-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-24" shape="pill" />
          </div>
          <Skeleton className="h-4" style={{ width: `${width}%` }} />
          <Skeleton className="h-3" style={{ width: `${width - 18}%` }} />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-32" shape="pill" />
            <Skeleton className="h-6 w-20" shape="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}
