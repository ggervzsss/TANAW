import { useEffect, useState } from "react";
import { fetchProfileImage } from "../services/accountManagement";

export function useAuthenticatedImage(sourceUrl: string | null | undefined) {
  const [loadedImage, setLoadedImage] = useState<{ sourceUrl: string; objectUrl: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let nextObjectUrl: string | null = null;
    if (!sourceUrl) return undefined;

    void fetchProfileImage(sourceUrl)
      .then((blob) => {
        if (disposed) return;
        nextObjectUrl = URL.createObjectURL(blob);
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
