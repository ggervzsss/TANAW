export type EnterpriseStatusFilter = "all" | "active" | "inactive";

export type LocationDraft = {
  latitude: number;
  longitude: number;
};

export type EnterpriseLocationSuggestion = LocationDraft & {
  placeId: string;
  name: string;
  formattedAddress: string;
  addressLine: string;
  barangay: string | null;
};
