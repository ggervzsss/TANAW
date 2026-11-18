import { describe, expect, it } from "vitest";
import type { MlDetectionTrack } from "../../../../../../src/features/camera/services/ml-service.types";
import { sexEstimateLabel, trackLabelLines } from "../../../../../../src/features/camera/model/track-labels";

const off = { detectionLabels: false, demographics: false };

function track(changes: Partial<MlDetectionTrack> = {}): MlDetectionTrack {
  return {
    track_id: 4,
    source_track_id: 4,
    bbox: [0, 0, 10, 20],
    confidence: 0.874,
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

describe("person box labels", () => {
  it("shows a plain box unless developer settings are on", () => {
    expect(trackLabelLines(track(), { analysisMode: "open_space", inMonitoredArea: true, developer: off })).toEqual([]);
  });

  it("labels the exact person with tracker number, state and confidence", () => {
    const developer = { ...off, detectionLabels: true };
    expect(trackLabelLines(track(), { analysisMode: "open_space", inMonitoredArea: true, developer })).toEqual(["#4 · In monitored area · 87%"]);
    expect(trackLabelLines(track({ source_track_id: 9 }), { analysisMode: "open_space", inMonitoredArea: false, developer })).toEqual(["#4 (src 9) · Observing · 87%"]);
    expect(trackLabelLines(track({ direction: "entry" }), { analysisMode: "entrance_exit", inMonitoredArea: false, developer })).toEqual(["#4 · Entry · 87%"]);
    expect(trackLabelLines(track({ track_id: -2 }), { analysisMode: "entrance_exit", inMonitoredArea: false, developer })[0]).toMatch(/^Unconfirmed · Tracking/);
  });

  it("adds the live male/female estimate on the same box", () => {
    const developer = { detectionLabels: true, demographics: true };
    const lines = trackLabelLines(track({ sex_estimate: { female_probability: 0.28, evidence_weight: 2.34, model: "sex-head@x" } }), {
      analysisMode: "open_space",
      inMonitoredArea: true,
      developer,
    });
    expect(lines).toEqual(["#4 · In monitored area · 87%", "Male 72% · evidence 2.3"]);
  });

  it("explains why an estimate is missing", () => {
    expect(sexEstimateLabel(track({ sex_estimate: { female_probability: 0.81, evidence_weight: 1, model: "m" } }))).toBe("Female 81% · evidence 1.0");
    expect(sexEstimateLabel(track({ sex_estimate: { female_probability: null, evidence_weight: 0, model: "m" } }))).toBe("Sex: needs a clearer view");
    expect(sexEstimateLabel(track())).toBe("Sex: model unavailable");
    expect(sexEstimateLabel(track({ track_id: 0 }))).toBe("Sex: waiting for tracking");
  });
});
