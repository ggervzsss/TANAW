import { describe, expect, it } from "vitest";
import type { MlAreaState } from "../../camera/services/ml-service";
import { combineLiveOccupancy } from "./combinedOccupancy";

const area = (presence: number | null, available = true): MlAreaState => ({
  available,
  presence,
  temporarily_missing: 2,
  active_visits: [],
  last_observed_at: null,
  zone_name: "Area",
  revision_id: "r1",
});

describe("combined live occupancy", () => {
  it("adds one entrance balance and all separate zone counts, excluding tracking gaps", () => {
    expect(combineLiveOccupancy(12, [area(3), area(2)])).toBe(17);
    expect(combineLiveOccupancy(0, [area(3), area(2)])).toBe(5);
  });

  it("recognizes observed empty zones as zero", () => {
    expect(combineLiveOccupancy(0, [area(0), area(0)])).toBe(0);
    expect(combineLiveOccupancy(12, [area(0)])).toBe(12);
  });

  it("does not undercount by treating unknown areas or an unavailable entrance balance as empty", () => {
    expect(combineLiveOccupancy(12, [area(3), undefined])).toBeNull();
    expect(combineLiveOccupancy(12, [area(null, false)])).toBeNull();
    expect(combineLiveOccupancy(null, [area(3)])).toBeNull();
  });
});
