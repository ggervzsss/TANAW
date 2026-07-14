import { useEffect, useState } from "react";
import { staffApi } from "../lib/axios";

const allowedImagePrefixes = ["/auth/profile/image/", "/operational/tickets/"];
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function useAuthenticatedImage(sourceUrl: string | null | undefined) {
  const [loadedImage, setLoadedImage] = useState<{ sourceUrl: string; objectUrl: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let nextObjectUrl: string | null = null;
    if (!sourceUrl || !allowedImagePrefixes.some((prefix) => sourceUrl.startsWith(prefix))) return undefined;

    void staffApi
      .get<Blob>(sourceUrl, { responseType: "blob" })
      .then((response) => {
        if (disposed || !allowedImageTypes.has(response.data.type)) return;
        nextObjectUrl = URL.createObjectURL(response.data);
        setLoadedImage({ sourceUrl, objectUrl: nextObjectUrl });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [sourceUrl]);

  return loadedImage && loadedImage.sourceUrl === sourceUrl ? loadedImage.objectUrl : null;
}
