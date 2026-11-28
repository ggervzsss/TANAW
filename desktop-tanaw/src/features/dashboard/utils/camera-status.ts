import type { EstablishmentLive } from "../../camera/services/establishment.types";
import { isCameraCounting } from "./establishment";

/** When a camera last started or stopped counting, as this computer saw it. */
export type CameraStatusMark = { counting: boolean; since: number };
export type CameraStatusMarks = Record<string, CameraStatusMark>;

/**
 * Updates the marks from a live reading: a camera keeps its time while its state holds, and gets
 * `now` when it changes or is seen for the first time. Cameras that are gone are dropped.
 */
export function nextCameraMarks(previous: CameraStatusMarks, cameraIds: number[], live: Pick<EstablishmentLive, "contributions" | "missing_camera_ids"> | null, now: number): CameraStatusMarks {
  if (!live) return previous;
  const next: CameraStatusMarks = {};
  for (const id of cameraIds) {
    const counting = isCameraCounting(id, live);
    const mark = previous[String(id)];
    next[String(id)] = mark && mark.counting === counting ? mark : { counting, since: now };
  }
  return next;
}

/** Reads stored marks; anything malformed is ignored. */
export function parseCameraMarks(raw: string | null): CameraStatusMarks {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object") return {};
    const marks: CameraStatusMarks = {};
    for (const [id, mark] of Object.entries(value as Record<string, unknown>)) {
      const candidate = mark as Partial<CameraStatusMark> | null;
      if (candidate && typeof candidate.counting === "boolean" && typeof candidate.since === "number") marks[id] = { counting: candidate.counting, since: candidate.since };
    }
    return marks;
  } catch {
    return {};
  }
}
