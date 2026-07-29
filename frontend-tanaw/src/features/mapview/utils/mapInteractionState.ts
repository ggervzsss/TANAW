export type MapDeselectReason = "all-barangays" | "back" | "map-background";

export type MapCameraTarget = { type: "citywide" } | { type: "barangay"; barangayName: string } | { type: "enterprise"; barangayName: string; enterpriseId: string };

export type MapInteractionState = {
  cameraTarget: MapCameraTarget;
  insightEnterpriseId: string | null;
  selectedBarangayName: string | null;
  selectedEnterpriseId: string | null;
};

export type MapInteractionAction =
  | { type: "select-barangay"; barangayName: string }
  | { type: "select-enterprise"; barangayName: string; enterpriseId: string }
  | { type: "clear-barangay"; reason: MapDeselectReason }
  | { type: "close-enterprise" }
  | { type: "show-area-insights" }
  | { type: "show-enterprise-insights"; enterpriseId: string };

export const initialMapInteractionState: MapInteractionState = {
  cameraTarget: { type: "citywide" },
  insightEnterpriseId: null,
  selectedBarangayName: null,
  selectedEnterpriseId: null,
};

export function mapInteractionReducer(state: MapInteractionState, action: MapInteractionAction): MapInteractionState {
  switch (action.type) {
    case "select-barangay": {
      if (
        state.selectedBarangayName === action.barangayName &&
        state.selectedEnterpriseId === null &&
        state.insightEnterpriseId === null &&
        state.cameraTarget.type === "barangay" &&
        state.cameraTarget.barangayName === action.barangayName
      ) {
        return state;
      }

      return {
        cameraTarget: { type: "barangay", barangayName: action.barangayName },
        insightEnterpriseId: null,
        selectedBarangayName: action.barangayName,
        selectedEnterpriseId: null,
      };
    }
    case "select-enterprise":
      return {
        cameraTarget: {
          type: "enterprise",
          barangayName: action.barangayName,
          enterpriseId: action.enterpriseId,
        },
        insightEnterpriseId: null,
        selectedBarangayName: action.barangayName,
        selectedEnterpriseId: action.enterpriseId,
      };
    case "clear-barangay": {
      if (state.selectedBarangayName === null && state.selectedEnterpriseId === null && state.insightEnterpriseId === null && state.cameraTarget.type === "citywide") {
        return state;
      }

      return initialMapInteractionState;
    }
    case "close-enterprise":
      return state.selectedEnterpriseId === null ? state : { ...state, selectedEnterpriseId: null };
    case "show-area-insights":
      return state.insightEnterpriseId === null ? state : { ...state, insightEnterpriseId: null };
    case "show-enterprise-insights":
      return state.insightEnterpriseId === action.enterpriseId ? state : { ...state, insightEnterpriseId: action.enterpriseId };
  }
}

export function shouldClearBarangayFromMapClick(selectedBarangayName: string | null, clickedBarangayName: string | null) {
  return selectedBarangayName !== null && clickedBarangayName === null;
}
