import type { SystemTimeFormat } from "../../../utils/date-time";
import type { EstablishmentLive } from "../../camera/services/establishment.types";

/** "2 PM" or, in 24-hour format, "14:00". */
export function formatHourLabel(hour: number, timeFormat: SystemTimeFormat) {
  if (timeFormat === "24-hour") return `${String(hour).padStart(2, "0")}:00`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Names the cameras that are not counting, e.g. "Gate A is not counting. 3 of 4 cameras are counting." */
export function camerasNotCountingMessage(cameras: Array<{ id: number; name: string }>, live: Pick<EstablishmentLive, "state" | "missing_camera_ids"> | null) {
  if (live?.state !== "partial") return null;
  const missing = new Set(live.missing_camera_ids);
  const stopped = cameras.filter((camera) => missing.has(camera.id)).map((camera) => camera.name);
  if (stopped.length === 0 || cameras.length === 0) return "Some cameras are not counting. Totals include the cameras that are counting.";
  const counting = cameras.length - stopped.length;
  return `${listNames(stopped)} ${stopped.length === 1 ? "is" : "are"} not counting. ${counting} of ${cameras.length} cameras ${counting === 1 ? "is" : "are"} counting.`;
}

/** Whether a camera feeds the live count right now. */
export function isCameraCounting(cameraId: number, live: Pick<EstablishmentLive, "contributions" | "missing_camera_ids"> | null) {
  if (!live) return false;
  if (live.missing_camera_ids.includes(cameraId)) return false;
  return live.contributions.some((item) => item.camera_ids.includes(cameraId));
}
