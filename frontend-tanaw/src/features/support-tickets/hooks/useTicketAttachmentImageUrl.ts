import { useEffect, useState } from "react";
import { fetchRequestAttachmentBlob, isSafeRequestImage, type RequestAttachment } from "@/shared/services/requests";

type AttachmentImageState = {
  attachmentKey: string;
  error: string;
  imageUrl: string | null;
  isLoading: boolean;
};

export function useTicketAttachmentImageUrl(attachment: RequestAttachment) {
  const attachmentKey = getAttachmentPreviewKey(attachment);
  const [state, setState] = useState<AttachmentImageState>({ attachmentKey: "", error: "", imageUrl: null, isLoading: false });

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    if (!isSafeRequestImage(attachment)) return undefined;

    void fetchRequestAttachmentBlob(attachment)
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

  if (!isSafeRequestImage(attachment)) return { error: "Unsupported image type", imageUrl: null, isLoading: false };
  if (state.attachmentKey !== attachmentKey) return { error: "", imageUrl: null, isLoading: true };
  return state;
}

function getAttachmentPreviewKey(attachment: RequestAttachment) {
  return [attachment.id, attachment.url, attachment.fileName, attachment.mediaType, attachment.sizeBytes].join(":");
}
