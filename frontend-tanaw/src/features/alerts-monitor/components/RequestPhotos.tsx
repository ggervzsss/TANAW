import { ImageIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { useTicketAttachmentImageUrl } from "@/features/support-tickets/hooks";
import { formatFileSize } from "@/features/support-tickets/model";
import type { RequestAttachment } from "@/shared/services/requests";
import { Dialog, Skeleton, cn } from "@/shared/ui-kit";

/** Photos the enterprise attached to a request, as small thumbnails that open a larger view. */
export function RequestPhotos({ attachments }: { attachments: RequestAttachment[] }) {
  const [preview, setPreview] = useState<RequestAttachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <h3 className="mt-6 text-base font-[650]">Photos</h3>
      <p className="mt-1 text-[13px] text-(--tanaw-text-secondary)">
        {attachments.length} {attachments.length === 1 ? "photo" : "photos"} attached by the enterprise
      </p>
      <ul className="mt-2.5 flex list-none flex-wrap gap-3 p-0">
        {attachments.map((attachment, index) => (
          <li key={attachment.id ?? `${attachment.fileName}-${index}`}>
            <button
              type="button"
              onClick={() => setPreview(attachment)}
              aria-label={`View photo ${attachment.fileName}`}
              className="group flex w-36 cursor-pointer flex-col gap-1.5 rounded-tanaw-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              <AttachmentImage attachment={attachment} alt="" className="h-24 w-36 rounded-tanaw-md border border-(--tanaw-border-soft) object-cover transition-[border-color,translate] duration-200 ease-tanaw-out group-hover:-translate-y-0.5 group-hover:border-(--tanaw-accent-ink) motion-reduce:transition-none motion-reduce:group-hover:translate-y-0" />
              <span className="block truncate text-[13px] font-semibold">{attachment.fileName}</span>
              <span className="block text-xs text-(--tanaw-text-muted)">{formatFileSize(attachment.sizeBytes)}</span>
            </button>
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {preview && (
          <Dialog title={preview.fileName} eyebrow="Photo" size="lg" onClose={() => setPreview(null)} closeLabel="Close photo">
            <AttachmentImage attachment={preview} alt={preview.fileName} className="max-h-[70vh] w-full rounded-tanaw-md object-contain" large />
          </Dialog>
        )}
      </AnimatePresence>
    </>
  );
}

function AttachmentImage({ attachment, alt, className, large = false }: { attachment: RequestAttachment; alt: string; className: string; large?: boolean }) {
  const { error, imageUrl, isLoading } = useTicketAttachmentImageUrl(attachment);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (imageUrl && failedUrl !== imageUrl && !error) return <img src={imageUrl} alt={alt} className={className} onError={() => setFailedUrl(imageUrl)} />;

  const message = isLoading ? "Loading photo" : "Photo could not be shown";
  if (isLoading) {
    // A placeholder in the photo's own shape while it loads, never a bare spinner.
    return (
      <span role={large ? "status" : undefined} aria-label={large ? message : undefined} className={cn(className, "relative block overflow-hidden", large && "min-h-72")}>
        <Skeleton className="absolute inset-0 h-full w-full rounded-[inherit]" />
        <span className="sr-only">{message}</span>
      </span>
    );
  }
  return (
    <span role={large ? "status" : undefined} className={cn(className, "flex items-center justify-center bg-(--tanaw-surface-inset) text-(--tanaw-text-muted)", large && "min-h-72 flex-col gap-2 text-sm font-semibold")}>
      <ImageIcon size={large ? 28 : 18} aria-hidden="true" />
      {large ? message : <span className="sr-only">{message}</span>}
    </span>
  );
}
