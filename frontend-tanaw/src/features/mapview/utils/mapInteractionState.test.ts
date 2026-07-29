import { describe, expect, it } from "vitest";
import { initialMapInteractionState, mapInteractionReducer, shouldClearBarangayFromMapClick, type MapDeselectReason } from "./mapInteractionState";

describe("map interaction state", () => {
  it("selects a barangay once for the polygon, dropdown, directory, and camera", () => {
    const selected = mapInteractionReducer(initialMapInteractionState, {
      type: "select-barangay",
      barangayName: "San Antonio",
    });

    expect(selected).toMatchObject({
      selectedBarangayName: "San Antonio",
      selectedEnterpriseId: null,
      insightEnterpriseId: null,
      cameraTarget: { type: "barangay", barangayName: "San Antonio" },
    });
    expect(
      mapInteractionReducer(selected, {
        type: "select-barangay",
        barangayName: "San Antonio",
      }),
    ).toBe(selected);
  });

  it("switches directly between barangays without a citywide intermediate state", () => {
    const first = mapInteractionReducer(initialMapInteractionState, {
      type: "select-barangay",
      barangayName: "San Antonio",
    });
    const second = mapInteractionReducer(first, {
      type: "select-barangay",
      barangayName: "Landayan",
    });

    expect(second.selectedBarangayName).toBe("Landayan");
    expect(second.cameraTarget).toEqual({ type: "barangay", barangayName: "Landayan" });
  });

  it.each<MapDeselectReason>(["map-background", "back", "all-barangays"])("uses the same complete reset for %s deselection", (reason) => {
    const selectedEnterprise = mapInteractionReducer(initialMapInteractionState, {
      type: "select-enterprise",
      barangayName: "San Antonio",
      enterpriseId: "enterprise-1",
    });
    const withInsights = mapInteractionReducer(selectedEnterprise, {
      type: "show-enterprise-insights",
      enterpriseId: "enterprise-1",
    });

    expect(mapInteractionReducer(withInsights, { type: "clear-barangay", reason })).toEqual(initialMapInteractionState);
  });

  it("keeps enterprise selection, barangay selection, and the camera target coordinated", () => {
    const selected = mapInteractionReducer(initialMapInteractionState, {
      type: "select-enterprise",
      barangayName: "Cuyab",
      enterpriseId: "enterprise-2",
    });

    expect(selected).toMatchObject({
      selectedBarangayName: "Cuyab",
      selectedEnterpriseId: "enterprise-2",
      cameraTarget: {
        type: "enterprise",
        barangayName: "Cuyab",
        enterpriseId: "enterprise-2",
      },
    });
  });

  it("lets the latest rapid interaction win", () => {
    const first = mapInteractionReducer(initialMapInteractionState, { type: "select-barangay", barangayName: "A" });
    const second = mapInteractionReducer(first, { type: "select-barangay", barangayName: "B" });
    const cleared = mapInteractionReducer(second, { type: "clear-barangay", reason: "map-background" });
    const latest = mapInteractionReducer(cleared, { type: "select-barangay", barangayName: "C" });

    expect(latest.selectedBarangayName).toBe("C");
    expect(latest.cameraTarget).toEqual({ type: "barangay", barangayName: "C" });
  });
});

describe("map background deselection", () => {
  it("clears only a selected barangay clicked outside every boundary", () => {
    expect(shouldClearBarangayFromMapClick("San Antonio", null)).toBe(true);
    expect(shouldClearBarangayFromMapClick("San Antonio", "Landayan")).toBe(false);
    expect(shouldClearBarangayFromMapClick("San Antonio", "San Antonio")).toBe(false);
    expect(shouldClearBarangayFromMapClick(null, null)).toBe(false);
  });
});
