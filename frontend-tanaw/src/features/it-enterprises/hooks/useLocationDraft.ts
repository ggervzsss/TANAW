import { useState } from "react";
import { sanPedroBarangayValues } from "@/features/enterprise-accounts/model";
import type { EnterpriseLocationSuggestion, LocationDraft } from "@/features/enterprise-accounts/types";
import type { BarangayPointResolution } from "@/features/mapview/utils";

function sameLocation(left: LocationDraft, right: LocationDraft) {
  return Math.abs(left.latitude - right.latitude) < 0.000001 && Math.abs(left.longitude - right.longitude) < 0.000001;
}

/**
 * The map pin of a form: where it is, the barangay its polygon says, and any problem with it. A pin
 * inside a known barangay fills the form's barangay.
 */
export function useLocationDraft(initial: LocationDraft | null, onBarangay: (barangay: string) => void, onAddress: (address: string) => void) {
  const [location, setLocation] = useState<LocationDraft | null>(initial);
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: LocationDraft, resolution?: BarangayPointResolution) => {
    setLocation(next);
    const barangay = resolution?.barangayName ?? null;
    setDetectedBarangay(barangay);
    setError(resolution?.isAmbiguous ? "This pin touches more than one barangay. Move it farther inside the right barangay." : null);
    if (barangay && sanPedroBarangayValues.has(barangay)) onBarangay(barangay);
  };

  return {
    location,
    detectedBarangay,
    error,
    setError,
    apply,
    onBoundaryDetection: (selected: LocationDraft, resolution: BarangayPointResolution) => {
      if (location && sameLocation(location, selected)) apply(selected, resolution);
    },
    onReject: (message: string) => setError(message),
    onSearchResult: (suggestion: EnterpriseLocationSuggestion) => onAddress(suggestion.addressLine),
    reset: (next: LocationDraft | null) => {
      setLocation(next);
      setDetectedBarangay(null);
      setError(null);
    },
  };
}

export type LocationDraftState = ReturnType<typeof useLocationDraft>;
