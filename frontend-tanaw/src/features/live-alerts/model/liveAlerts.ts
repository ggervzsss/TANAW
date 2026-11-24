import type { LiveAlert } from "@/shared/types";
import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * Live alerts: what is happening right now. A place busier than usual (amber) or a camera that
 * is not counting (red). Alerts end by themselves when the problem clears; nobody marks them.
 */

export type AlertTone = "busy" | "camera";

export function alertTone(alert: Pick<LiveAlert, "type">): AlertTone {
  return alert.type === "Camera Not Counting" ? "camera" : "busy";
}

export function alertKindLabel(alert: Pick<LiveAlert, "type">) {
  return alert.type === "Camera Not Counting" ? "Camera not counting" : "Busier than usual";
}

/** The place and, for a camera alert, the camera: "Sampaguita Gardens · Gate A". */
export function alertPlace(alert: Pick<LiveAlert, "enterpriseName" | "camera">) {
  return [alert.enterpriseName ?? "A place", alert.camera].filter(Boolean).join(" · ");
}

/** "Since 3:15 PM", or "Since Nov 21, 3:15 PM" for an alert from another day. */
export function alertSince(startedAt: string, now: Date, timeFormat: SystemTimeFormat) {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: PHILIPPINE_TIME_ZONE }).format(value);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
  if (day(date) === day(now)) return `Since ${time}`;
  const date_ = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
  return `Since ${date_}, ${time}`;
}

/** The Dashboard address that opens this place on the map. */
export function alertMapPath(alert: Pick<LiveAlert, "enterpriseId">, dashboardPath: string) {
  return alert.enterpriseId ? `${dashboardPath}?${new URLSearchParams({ place: alert.enterpriseId })}` : dashboardPath;
}

export function alertCountLabel(count: number) {
  if (count === 0) return "No live alerts";
  return `${count} live ${count === 1 ? "alert" : "alerts"}`;
}
