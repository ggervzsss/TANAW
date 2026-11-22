import { describe, expect, it } from "vitest";
import type { MlDetectionTrack } from "../../../../../../src/features/camera/services/ml-service.types";
import { holdRecentTracks, nextHoldExpiry } from "../../../../../../src/features/camera/model/track-hold";

function track(trackId: number, changes: Partial<MlDetectionTrack> = {}): MlDetectionTrack {
  return {
    track_id: trackId,
    source_track_id: trackId,
    bbox: [0, 0, 10, 20],
    confidence: 0.9,
    centroid: [5, 10],
    direction: null,
    visitor_id: null,
    is_unique_entry: null,
    reid_score: null,
    reid_decision: null,
    identity_confidence: null,
    inside_roi: true,
    counting_eligible: true,
    identity_state: null,
    identity_score: null,
    identity_source: null,
    counting_debug: null,
    ...changes,
  };
}

describe("held person boxes", () => {
  it("keeps a briefly missed person on screen from their last position", () => {
    const first = holdRecentTracks([], [track(1, { direction: "entry" }), track(2)], 0);
    const missed = holdRecentTracks(first, [track(2, { bbox: [4, 0, 14, 20] })], 200);
    expect(missed.map((item) => [item.track_id, item.held])).toEqual([
      [2, false],
      [1, true],
    ]);
    // A held box never re-announces a crossing.
    expect(missed.find((item) => item.track_id === 1)?.direction).toBeNull();
    expect(missed[0].bbox).toEqual([4, 0, 14, 20]);
  });

  it("drops a held person after the hold and when they are detected again", () => {
    const first = holdRecentTracks([], [track(1)], 0);
    expect(holdRecentTracks(first, [], 699, 700)).toHaveLength(1);
    expect(holdRecentTracks(first, [], 700, 700)).toHaveLength(0);
    const back = holdRecentTracks(holdRecentTracks(first, [], 300), [track(1)], 400);
    expect(back).toHaveLength(1);
    expect(back[0].held).toBe(false);
  });

  it("never holds untracked detections and reports when the next hold ends", () => {
    const first = holdRecentTracks([], [track(-1), track(3)], 0);
    const later = holdRecentTracks(first, [], 100, 700);
    expect(later.map((item) => item.track_id)).toEqual([3]);
    expect(nextHoldExpiry(later, 100, 700)).toBe(600);
    expect(nextHoldExpiry(holdRecentTracks([], [track(3)], 0), 0)).toBeNull();
  });
});
