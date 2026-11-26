import { useEffect, useState } from "react";
import type { Camera } from "../../../types/enterprise";
import type { EstablishmentLive } from "../../camera/services/establishment.types";
import { useAuthStore } from "../../login/stores/auth-store";
import { nextCameraMarks, parseCameraMarks, type CameraStatusMarks } from "../utils/camera-status";

const STORAGE_PREFIX = "tanaw:camera-status:";

function read(key: string) {
  try {
    return parseCameraMarks(localStorage.getItem(key));
  } catch {
    return {};
  }
}

/**
 * Remembers on this computer when each camera started or stopped counting, so the dashboard can say
 * "counting since 7:02 AM" or "not counting since 3:10 PM". The local service reports only whether a
 * camera counts now, so a time is the first moment this computer saw the change.
 */
export function useCameraStatusTimes(cameras: Camera[], live: EstablishmentLive | null, override?: CameraStatusMarks) {
  const enterpriseId = useAuthStore((state) => state.user?.enterpriseId) ?? "local";
  const key = `${STORAGE_PREFIX}${enterpriseId}`;
  const [marks, setMarks] = useState<CameraStatusMarks>(() => read(key));
  const ids = cameras.map((camera) => camera.id).join(",");

  useEffect(() => {
    if (override || !live) return;
    setMarks((previous) => {
      const next = nextCameraMarks(previous, ids ? ids.split(",").map(Number) : [], live, Date.now());
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Without storage the times last until the app closes.
      }
      return next;
    });
  }, [ids, key, live, override]);

  return override ?? marks;
}
