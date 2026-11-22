import { useEffect, useState } from "react";
import type { MlDetectionTrack } from "../services/ml-service.types";
import { holdRecentTracks, nextHoldExpiry, TRACK_HOLD_MS, type DisplayedTrack } from "../model/track-hold";

type HeldTracks = { resetKey: string | number; tracks: DisplayedTrack[] };

/**
 * The tracks to draw: the latest detections plus people missed for a moment.
 * `tracks` must keep its identity between renders unless the detections changed.
 * Changing `resetKey` (the camera) discards held boxes.
 */
export function useHeldTracks(tracks: readonly MlDetectionTrack[], resetKey: string | number, holdMs: number = TRACK_HOLD_MS): DisplayedTrack[] {
  const [held, setHeld] = useState<HeldTracks>(() => ({ resetKey, tracks: holdRecentTracks([], tracks, performance.now(), holdMs) }));

  useEffect(() => {
    setHeld((previous) => ({
      resetKey,
      tracks: holdRecentTracks(previous.resetKey === resetKey ? previous.tracks : [], tracks, performance.now(), holdMs),
    }));
  }, [holdMs, resetKey, tracks]);

  useEffect(() => {
    const delay = nextHoldExpiry(held.tracks, performance.now(), holdMs);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => {
      setHeld((previous) => {
        const now = performance.now();
        return { ...previous, tracks: previous.tracks.filter((track) => !track.held || now - track.lastSeenAt < holdMs) };
      });
    }, delay + 16);
    return () => {
      window.clearTimeout(timer);
    };
  }, [held, holdMs]);

  return held.resetKey === resetKey ? held.tracks : holdRecentTracks([], tracks, performance.now(), holdMs);
}
