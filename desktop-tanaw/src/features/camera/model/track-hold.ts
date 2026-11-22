import type { MlDetectionTrack } from "../services/ml-service.types";

/** How long a box stays on screen after its person is briefly missed by the detector. */
export const TRACK_HOLD_MS = 700;

/** Detections older than this no longer describe the live video, so their boxes are hidden. */
export const DETECTION_STALE_MS = 1500;

/** Whether the latest detections are recent enough to draw over the live video. */
export function detectionsAreFresh(processedFrameStaleMs: number | null | undefined, staleMs: number = DETECTION_STALE_MS): boolean {
  return processedFrameStaleMs == null || processedFrameStaleMs < staleMs;
}

export type DisplayedTrack = MlDetectionTrack & {
  /** Shown from its last position because the latest update missed it. */
  held: boolean;
  lastSeenAt: number;
};

/**
 * Merge the latest detections with tracks seen moments ago.
 *
 * The detector drops a person for a frame or two during partial occlusion. Keeping their box
 * briefly stops boxes blinking off and on. Only tracked people (positive IDs) are kept;
 * untracked detections get new IDs every frame.
 */
export function holdRecentTracks(
  previous: readonly DisplayedTrack[],
  current: readonly MlDetectionTrack[],
  now: number,
  holdMs: number = TRACK_HOLD_MS,
): DisplayedTrack[] {
  const currentIds = new Set(current.map((track) => track.track_id));
  const fresh = current.map((track) => ({ ...track, held: false, lastSeenAt: now }));
  const kept = previous
    .filter((track) => track.track_id > 0 && !currentIds.has(track.track_id) && now - track.lastSeenAt < holdMs)
    .map((track) => ({ ...track, held: true, direction: null }));
  return [...fresh, ...kept];
}

/** Milliseconds until the next held track expires, or null when none is held. */
export function nextHoldExpiry(tracks: readonly DisplayedTrack[], now: number, holdMs: number = TRACK_HOLD_MS): number | null {
  const remaining = tracks.filter((track) => track.held).map((track) => track.lastSeenAt + holdMs - now);
  return remaining.length ? Math.max(0, Math.min(...remaining)) : null;
}
