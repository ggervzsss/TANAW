import { ImageIcon, Paperclip } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { ModalFrame } from "@/shared/components/ui";
import { isSafeRequestImage, type RequestAttachment } from "@/shared/services/requests";
import { Skeleton, cn } from "@/shared/ui-kit";
import { useTicketAttachmentImageUrl } from "../hooks";
import { formatFileSize } from "../model";

export function TicketAttachments({ attachments }: { attachments: RequestAttachment[] }) {
  const [previewAttachment, setPreviewAttachment] = useState<RequestAttachment | null>(null);

  return (
    <>
      <section className="support-tickets__section">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-[0.9375rem] font-[650] text-(--tanaw-text)">
            <Paperclip size={16} aria-hidden="true" className="text-(--tanaw-accent-ink)" />
            Photos
          </h4>
          <span className="text-[13px] text-(--tanaw-text-muted)">{attachments.length} attached</span>
        </div>
        {attachments.length > 0 ? (
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {attachments.map((attachment, index) => (
              <button
                key={attachment.id ?? `${attachment.fileName}-${index}`}
                type="button"
                onClick={() => setPreviewAttachment(attachment)}
                className="rounded-tanaw-md flex items-center gap-3 p-2 text-left transition-colors duration-150 hover:bg-(--tanaw-control-hover)"
              >
                <TicketAttachmentImage attachment={attachment} alt="" className="rounded-tanaw-sm h-16 w-16 object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-(--tanaw-text)">{attachment.fileName}</span>
                  <span className="mt-1 block text-xs text-(--tanaw-text-muted)">{formatFileSize(attachment.sizeBytes)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-(--tanaw-text-secondary)">No photos were attached to this request.</p>
        )}
      </section>

      <AnimatePresence>{previewAttachment && <TicketAttachmentPreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}</AnimatePresence>
    </>
  );
}

function TicketAttachmentPreview({ attachment, onClose }: { attachment: RequestAttachment; onClose: () => void }) {
  return (
    <ModalFrame title={attachment.fileName} eyebrow="Ticket Photo" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="rounded-tanaw-lg bg-(--tanaw-surface-inset) p-3">
        <TicketAttachmentImage attachment={attachment} alt={attachment.fileName} className="rounded-tanaw-md max-h-[70vh] w-full object-contain" isFullPreview />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-(--tanaw-text-secondary)">
          <span className="truncate">{attachment.fileName}</span>
          <span>{formatFileSize(attachment.sizeBytes)}</span>
        </div>
      </div>
    </ModalFrame>
  );
}

function TicketAttachmentImage({ alt, attachment, className, isFullPreview = false }: { alt: string; attachment: RequestAttachment; className: string; isFullPreview?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const renderError = imageUrl && failedImageUrl === imageUrl ? "Image could not be rendered" : "";

  if (!isSafeRequestImage(attachment)) return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message="Unsupported image type" />;
  if (error || renderError) return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message={renderError || error || "Image could not be loaded"} />;
  if (isLoading || !imageUrl) return <Skeleton className={cn(className, isFullPreview && "min-h-72")} label="Loading image" />;
  return <img src={imageUrl} alt={alt} className={className} onError={() => setFailedImageUrl(imageUrl)} />;
}

function AttachmentImageFallback({ className, isFullPreview, message }: { className: string; isFullPreview: boolean; message: string }) {
  return (
    <div className={cn(className, "flex items-center justify-center bg-(--tanaw-surface-inset) text-center text-(--tanaw-text-secondary)", isFullPreview && "min-h-72")}>
      <span className="flex max-w-full flex-col items-center gap-2 px-3">
        <ImageIcon size={isFullPreview ? 30 : 18} aria-hidden="true" className="text-(--tanaw-text-muted)" />
        {isFullPreview && <span className="text-sm font-medium">{message}</span>}
      </span>
    </div>
  );
}
