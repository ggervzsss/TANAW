import type { LiveAlert } from "@/shared/types";

/*
 * Camera pop-ups for the Admin: a toast when a camera stops counting while the Admin is signed in.
 * Alerts already there when the alerts first load stay quiet; so does any alert this tab has
 * already announced, even if it ends and comes back. Busy-place alerts never pop up.
 */

/** At most this many camera toasts at once; the rest are summed up in one more toast. */
export const MAX_CAMERA_ALERT_TOASTS = 3;

/** How many announced alert IDs the tab remembers. */
const MAX_ANNOUNCED_IDS = 200;

export type CameraAlertDiff = {
  /** The camera alerts to pop up now, in the order they came. */
  announce: LiveAlert[];
  /** Every alert ID seen so far, to pass back in with the next alerts. */
  known: Set<string>;
};

/**
 * Diffs the alerts seen so far against the alerts now. `known` is null before the alerts first
 * load: that first load only learns what is already there. `announced` holds the IDs this tab
 * popped up before (they survive a reload), so the same alert never pops up twice.
 */
export function diffCameraAlerts(known: ReadonlySet<string> | null, alerts: readonly LiveAlert[], announced: ReadonlySet<string> = new Set()): CameraAlertDiff {
  const next = new Set(known ?? []);
  for (const alert of alerts) next.add(alert.id);
  if (known === null) return { announce: [], known: next };
  const announce = alerts.filter((alert) => alert.type === "Camera Not Counting" && !known.has(alert.id) && !announced.has(alert.id));
  return { announce, known: next };
}

/** The toast's stable ID, so one alert never shows twice. */
export function cameraAlertToastId(alert: Pick<LiveAlert, "id">) {
  return `camera-alert:${alert.id}`;
}

/** "2 more cameras are not counting." for the alerts past the toast limit. */
export function moreCameraAlertsLabel(count: number) {
  return `${count} more ${count === 1 ? "camera is" : "cameras are"} not counting.`;
}

/** The announced IDs to keep: the newest last, trimmed to the most recent ones. */
export function rememberAnnounced(announced: readonly string[], ids: readonly string[]) {
  const merged = [...announced.filter((id) => !ids.includes(id)), ...ids];
  return merged.slice(-MAX_ANNOUNCED_IDS);
}

export function parseAnnounced(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
