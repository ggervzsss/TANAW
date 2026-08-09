import { useEffect, useState } from "react";
import { fetchSupportTicketAttachmentBlob, isSafeSupportTicketImage, type SupportTicketAttachment } from "@/shared/services/supportTickets";

type AttachmentImageState = {
  attachmentKey: string;
  error: string;
  imageUrl: string | null;
  isLoading: boolean;
};

export function useTicketAttachmentImageUrl(attachment: SupportTicketAttachment) {
  const attachmentKey = getAttachmentPreviewKey(attachment);
  const [state, setState] = useState<AttachmentImageState>({ attachmentKey: "", error: "", imageUrl: null, isLoading: false });

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    if (!isSafeSupportTicketImage(attachment)) return undefined;

    void fetchSupportTicketAttachmentBlob(attachment)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ attachmentKey, error: "", imageUrl: objectUrl, isLoading: false });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setState({ attachmentKey, error: error instanceof Error ? error.message : "Image could not be loaded", imageUrl: null, isLoading: false });
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, attachmentKey]);

  if (!isSafeSupportTicketImage(attachment)) return { error: "Unsupported image type", imageUrl: null, isLoading: false };
  if (state.attachmentKey !== attachmentKey) return { error: "", imageUrl: null, isLoading: true };
  return state;
}

function getAttachmentPreviewKey(attachment: SupportTicketAttachment) {
  return [attachment.id ?? "", attachment.url ?? "", attachment.fileName, attachment.mediaType, attachment.sizeBytes, attachment.dataUrl?.length ?? 0].join(":");
}
