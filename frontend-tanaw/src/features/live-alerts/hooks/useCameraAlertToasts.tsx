import { useEffect, useRef } from "react";
import toast from "react-hot-toast/headless";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { CameraAlertToastMessage } from "../components/CameraAlertToastMessage";
import { MAX_CAMERA_ALERT_TOASTS, cameraAlertToastId, diffCameraAlerts, moreCameraAlertsLabel, parseAnnounced, rememberAnnounced } from "../model/cameraAlertToasts";
import { alertMapPath, alertSince } from "../model/liveAlerts";

const CAMERA_ALERT_TOAST_MS = 8_000;
const ANNOUNCED_KEY = "tanaw:camera-alert-toasts";

/**
 * Pops up a toast when a camera stops counting while the Admin is signed in: "Camera not counting:
 * Sampaguita Gardens · Gate A", since when, and "View on map". Mount it once, beside the topbar's
 * alerts button; it shares that button's live alerts query.
 */
export function useCameraAlertToasts({ enabled, dashboardPath }: { enabled: boolean; dashboardPath: string }) {
  const { alerts, isSuccess } = useAlerts(enabled);
  const accountId = useAuthStore((state) => state.user?.id ?? "anonymous");
  const { timeFormat } = useSystemDisplayPreferences();
  const navigate = useNavigate();
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled || !isSuccess) return;
    const storageKey = `${ANNOUNCED_KEY}:${accountId}`;
    const announced = readAnnounced(storageKey);
    const diff = diffCameraAlerts(known.current, alerts, new Set(announced));
    known.current = diff.known;
    if (diff.announce.length === 0) return;
    writeAnnounced(storageKey, rememberAnnounced(announced, diff.announce.map((alert) => alert.id)));

    const now = new Date();
    for (const alert of diff.announce.slice(0, MAX_CAMERA_ALERT_TOASTS)) {
      const id = cameraAlertToastId(alert);
      const viewOnMap = () => {
        toast.dismiss(id);
        navigate(alertMapPath(alert, dashboardPath));
      };
      toast.error(<CameraAlertToastMessage alert={alert} since={alertSince(alert.startedAt, now, timeFormat)} onViewOnMap={viewOnMap} />, { id, duration: CAMERA_ALERT_TOAST_MS });
    }
    const more = diff.announce.length - MAX_CAMERA_ALERT_TOASTS;
    if (more > 0) toast.error(moreCameraAlertsLabel(more), { id: "camera-alert:more", duration: CAMERA_ALERT_TOAST_MS });
  }, [accountId, alerts, dashboardPath, enabled, isSuccess, navigate, timeFormat]);
}

function readAnnounced(key: string) {
  try {
    return parseAnnounced(window.sessionStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeAnnounced(key: string, ids: readonly string[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage may be blocked; this tab still remembers the alerts it has seen while it stays open.
  }
}
