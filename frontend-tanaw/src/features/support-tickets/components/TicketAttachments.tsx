import { ImageIcon, Paperclip, RefreshCw } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { ModalFrame } from "@/shared/components/ui";
import { isSafeSupportTicketImage, type SupportTicketAttachment } from "@/shared/services/supportTickets";
import { useTicketAttachmentImageUrl } from "../hooks";
import { formatFileSize } from "../model";

export function TicketAttachments({ attachments }: { attachments: SupportTicketAttachment[] }) {
  const [previewAttachment, setPreviewAttachment] = useState<SupportTicketAttachment | null>(null);

  return (
    <>
      <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm dark:border-emerald-300/20 dark:bg-[#121c31]">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
            <Paperclip size={16} className="text-emerald-700" />
            Photos
          </h4>
          <span className="text-[11px] font-bold text-slate-400 uppercase">{attachments.length} attached</span>
        </div>
        {attachments.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {attachments.map((attachment, index) => (
              <button
                key={attachment.id ?? `${attachment.fileName}-${index}`}
                type="button"
                onClick={() => setPreviewAttachment(attachment)}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-700 dark:bg-[#0f172a] dark:hover:border-emerald-300/30 dark:hover:bg-emerald-500/10"
              >
                <TicketAttachmentImage attachment={attachment} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-950">{attachment.fileName}</span>
                  <span className="mt-1 block text-[11px] font-semibold text-slate-500">{formatFileSize(attachment.sizeBytes)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">No photos were attached to this request.</p>
        )}
      </section>

      <AnimatePresence>{previewAttachment && <TicketAttachmentPreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}</AnimatePresence>
    </>
  );
}

function TicketAttachmentPreview({ attachment, onClose }: { attachment: SupportTicketAttachment; onClose: () => void }) {
  return (
    <ModalFrame title={attachment.fileName} eyebrow="Ticket Photo" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
        <TicketAttachmentImage attachment={attachment} alt={attachment.fileName} className="max-h-[70vh] w-full rounded-2xl object-contain" isFullPreview />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-semibold text-slate-500">
          <span className="truncate">{attachment.fileName}</span>
          <span>{formatFileSize(attachment.sizeBytes)}</span>
        </div>
      </div>
    </ModalFrame>
  );
}

function TicketAttachmentImage({ alt, attachment, className, isFullPreview = false }: { alt: string; attachment: SupportTicketAttachment; className: string; isFullPreview?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const renderError = imageUrl && failedImageUrl === imageUrl ? "Image could not be rendered" : "";

  if (!isSafeSupportTicketImage(attachment)) return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message="Unsupported image type" />;
  if (error || renderError) return <AttachmentImageFallback className={className} isFullPreview={isFullPreview} message={renderError || error || "Image could not be loaded"} />;
  if (isLoading || !imageUrl) return <AttachmentImageFallback className={className} icon="loading" isFullPreview={isFullPreview} message="Loading image" />;
  return <img src={imageUrl} alt={alt} className={className} onError={() => setFailedImageUrl(imageUrl)} />;
}

function AttachmentImageFallback({ className, icon = "error", isFullPreview, message }: { className: string; icon?: "error" | "loading"; isFullPreview: boolean; message: string }) {
  return (
    <div
      className={`${className} flex ${isFullPreview ? "min-h-72" : ""} items-center justify-center border border-dashed border-slate-200 bg-white text-center text-slate-500 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-300`}
    >
      <span className="flex max-w-full flex-col items-center gap-2 px-3">
        {icon === "loading" ? <RefreshCw size={isFullPreview ? 28 : 18} className="animate-spin text-emerald-700" /> : <ImageIcon size={isFullPreview ? 30 : 18} className="text-slate-400" />}
        {isFullPreview && <span className="text-sm font-semibold">{message}</span>}
      </span>
    </div>
  );
}
