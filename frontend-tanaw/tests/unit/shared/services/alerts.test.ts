import { describe, expect, it } from "vitest";
import { sortLiveAlerts } from "../../../../src/shared/services/alerts";
import type { LiveAlert } from "../../../../src/shared/types";

function alert(id: string, type: LiveAlert["type"], startedAt: string): LiveAlert {
  return { id, type, severity: "Warning", status: "Active", enterpriseId: "ENT-1", enterpriseName: "Sampaguita Gardens", camera: null, summary: "A summary.", startedAt };
}

describe("live alerts", () => {
  it("lists cameras that are not counting first, then newest first", () => {
    const sorted = sortLiveAlerts([
      alert("busy-new", "Busier Than Usual", "2026-11-23T08:00:00Z"),
      alert("camera-old", "Camera Not Counting", "2026-11-23T05:00:00Z"),
      alert("busy-old", "Busier Than Usual", "2026-11-23T06:00:00Z"),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["camera-old", "busy-new", "busy-old"]);
  });
});
