import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import { type CameraAction, updateCamerasWhenChanged } from "../model/camera-management";

export const CAMERA_START_SETTLE_TIMEOUT_MS = 90_000;
export const CAMERA_START_SETTLE_TIMEOUT_MESSAGE = "Camera startup did not reach a running state within 90 seconds.";

type CameraStartDeadlineMonitorOptions = {
  cameraActionsRef: MutableRefObject<Record<number, CameraAction | undefined>>;
  cameraStartDeadlinesRef: MutableRefObject<Record<number, number>>;
  setCameraActions: Dispatch<SetStateAction<Record<number, CameraAction | undefined>>>;
  setCameraErrors: Dispatch<SetStateAction<Record<number, string | null>>>;
  setCameras: Dispatch<SetStateAction<Camera[]>>;
};

export function useCameraStartDeadlineMonitor({ cameraActionsRef, cameraStartDeadlinesRef, setCameraActions, setCameraErrors, setCameras }: CameraStartDeadlineMonitorOptions) {
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const expiredIds = Object.entries(cameraStartDeadlinesRef.current)
        .filter(([, deadline]) => now >= deadline)
        .map(([cameraId]) => Number(cameraId));
      if (expiredIds.length === 0) return;

      const expiredSet = new Set(expiredIds);
      for (const cameraId of expiredIds) delete cameraStartDeadlinesRef.current[cameraId];
      setCameraActions((current) => {
        const next = { ...current };
        for (const cameraId of expiredIds) delete next[cameraId];
        cameraActionsRef.current = next;
        return next;
      });
      setCameraErrors((current) => {
        const next = { ...current };
        for (const cameraId of expiredIds) next[cameraId] = CAMERA_START_SETTLE_TIMEOUT_MESSAGE;
        return next;
      });
      setCameras((current) => updateCamerasWhenChanged(current, (camera) => (expiredSet.has(camera.id) ? { ...camera, status: "error" } : camera)));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [cameraActionsRef, cameraStartDeadlinesRef, setCameraActions, setCameraErrors, setCameras]);
}
