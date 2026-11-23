export type MapDeselectReason = "all-barangays" | "back" | "inactive" | "map-background";

export type MapCameraTarget = { type: "citywide"; fit?: true } | { type: "barangay"; barangayName: string } | { type: "enterprise"; barangayName: string; enterpriseId: string };

export type MapInteractionState = {
  cameraTarget: MapCameraTarget;
  selectedBarangayName: string | null;
  selectedEnterpriseId: string | null;
};

export type MapInteractionAction =
  | { type: "select-barangay"; barangayName: string }
  | { type: "select-enterprise"; barangayName: string; enterpriseId: string }
  /**
   * Selects an enterprise without zooming to it. With `drill`, the map also opens the enterprise's
   * barangay, where the dashboard shows that barangay's other enterprises; otherwise the camera stays.
   */
  | { type: "show-enterprise"; barangayName: string; enterpriseId: string; drill: boolean }
  | { type: "clear-barangay"; reason: MapDeselectReason }
  | { type: "close-enterprise"; enterpriseId: string };

export const initialMapInteractionState: MapInteractionState = {
  cameraTarget: { type: "citywide" },
  selectedBarangayName: null,
  selectedEnterpriseId: null,
};

export function mapInteractionReducer(state: MapInteractionState, action: MapInteractionAction): MapInteractionState {
  switch (action.type) {
    case "select-barangay":
      return {
        cameraTarget: { type: "barangay", barangayName: action.barangayName },
        selectedBarangayName: action.barangayName,
        selectedEnterpriseId: null,
      };
    case "select-enterprise":
      return {
        cameraTarget:
          state.cameraTarget.type === "enterprise" && state.cameraTarget.enterpriseId === action.enterpriseId
            ? state.cameraTarget
            : { type: "enterprise", barangayName: action.barangayName, enterpriseId: action.enterpriseId },
        selectedBarangayName: state.selectedBarangayName,
        selectedEnterpriseId: action.enterpriseId,
      };
    case "show-enterprise":
      if (!action.drill) return { ...state, selectedEnterpriseId: action.enterpriseId };
      return {
        cameraTarget: state.cameraTarget.type === "barangay" && state.selectedBarangayName === action.barangayName ? state.cameraTarget : { type: "barangay", barangayName: action.barangayName },
        selectedBarangayName: action.barangayName,
        selectedEnterpriseId: action.enterpriseId,
      };
    case "clear-barangay": {
      if (action.reason !== "map-background") {
        return { ...initialMapInteractionState, cameraTarget: { type: "citywide", fit: true } };
      }
      if (state.selectedBarangayName === null && state.selectedEnterpriseId === null && state.cameraTarget.type === "citywide") {
        return state;
      }

      return initialMapInteractionState;
    }
    case "close-enterprise":
      return state.selectedEnterpriseId === action.enterpriseId ? { ...state, selectedEnterpriseId: null } : state;
  }
}

export function shouldClearBarangayFromMapClick(selectedBarangayName: string | null, clickedBarangayName: string | null) {
  return selectedBarangayName !== null && clickedBarangayName === null;
}
