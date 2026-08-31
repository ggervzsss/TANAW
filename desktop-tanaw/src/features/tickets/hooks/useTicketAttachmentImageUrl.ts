import { useEffect, useState } from "react";
import { fetchSupportTicketAttachmentBlob, type SupportTicketAttachment } from "../services/tickets";

type AttachmentImageState = {
  attachmentKey: string;
  error: string;
  imageUrl: string | null;
  isLoading: boolean;
};

export function useTicketAttachmentImageUrl(attachment: SupportTicketAttachment) {
  const attachmentKey = [attachment.id, attachment.url, attachment.fileName, attachment.mediaType, attachment.sizeBytes].join(":");
  const [state, setState] = useState<AttachmentImageState>({ attachmentKey: "", error: "", imageUrl: null, isLoading: false });

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

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

  if (state.attachmentKey !== attachmentKey) return { error: "", imageUrl: null, isLoading: true };
  return state;
}
