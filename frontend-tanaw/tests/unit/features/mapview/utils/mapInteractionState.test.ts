import { describe, expect, it } from "vitest";
import { initialMapInteractionState, mapInteractionReducer, shouldClearBarangayFromMapClick, type MapDeselectReason } from "../../../../../src/features/mapview/utils/mapInteractionState";

describe("map interaction state", () => {
  it("refits an already-selected barangay after a click", () => {
    const selected = mapInteractionReducer(initialMapInteractionState, {
      type: "select-barangay",
      barangayName: "San Antonio",
    });

    expect(selected).toMatchObject({
      selectedBarangayName: "San Antonio",
      selectedEnterpriseId: null,
      cameraTarget: { type: "barangay", barangayName: "San Antonio" },
    });
    const refitted = mapInteractionReducer(selected, {
      type: "select-barangay",
      barangayName: "San Antonio",
    });
    expect(refitted).toEqual(selected);
    expect(refitted.cameraTarget).not.toBe(selected.cameraTarget);
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

  it.each<MapDeselectReason>(["map-background", "back", "all-barangays", "inactive"])("clears selection on %s and fits the city only on request", (reason) => {
    const selectedEnterprise = mapInteractionReducer(initialMapInteractionState, {
      type: "select-enterprise",
      barangayName: "San Antonio",
      enterpriseId: "enterprise-1",
    });
    expect(mapInteractionReducer(selectedEnterprise, { type: "clear-barangay", reason })).toEqual({
      ...initialMapInteractionState,
      cameraTarget: reason === "map-background" ? { type: "citywide" } : { type: "citywide", fit: true },
    });
  });

  it("keeps enterprise selection, barangay selection, and the camera target coordinated", () => {
    const selected = mapInteractionReducer(initialMapInteractionState, {
      type: "select-enterprise",
      barangayName: "Cuyab",
      enterpriseId: "enterprise-2",
    });

    expect(selected).toMatchObject({
      selectedBarangayName: null,
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

  it("reopens an enterprise without issuing the same camera target again", () => {
    const select = { type: "select-enterprise", barangayName: "Cuyab", enterpriseId: "enterprise-2" } as const;
    const selected = mapInteractionReducer(initialMapInteractionState, select);
    const closed = mapInteractionReducer(selected, { type: "close-enterprise", enterpriseId: select.enterpriseId });
    const reopened = mapInteractionReducer(closed, select);

    expect(reopened.selectedEnterpriseId).toBe(select.enterpriseId);
    expect(reopened.cameraTarget).toBe(selected.cameraTarget);
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

describe("showing an enterprise without zooming to it", () => {
  it("selects a pin in place when it does not open a barangay", () => {
    const state = mapInteractionReducer(initialMapInteractionState, { type: "show-enterprise", barangayName: "Poblacion", enterpriseId: "plaza", drill: false });

    expect(state).toEqual({ ...initialMapInteractionState, selectedEnterpriseId: "plaza" });
    expect(state.cameraTarget).toBe(initialMapInteractionState.cameraTarget);
  });

  it("opens the enterprise's barangay when drilling in, and keeps the camera for another pin there", () => {
    const drilled = mapInteractionReducer(initialMapInteractionState, { type: "show-enterprise", barangayName: "Landayan", enterpriseId: "church", drill: true });
    expect(drilled).toEqual({ cameraTarget: { type: "barangay", barangayName: "Landayan" }, selectedBarangayName: "Landayan", selectedEnterpriseId: "church" });

    const again = mapInteractionReducer(drilled, { type: "show-enterprise", barangayName: "Landayan", enterpriseId: "walk", drill: true });
    expect(again.cameraTarget).toBe(drilled.cameraTarget);
    expect(again.selectedEnterpriseId).toBe("walk");
  });
});
