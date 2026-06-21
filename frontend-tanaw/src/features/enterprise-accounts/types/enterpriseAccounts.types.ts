export type EnterpriseStatusFilter = "all" | "active" | "inactive";

export type LocationDraft = {
  latitude: number;
  longitude: number;
  source: "geocoded" | "manual" | "adjusted";
  confidence?: number | null;
  displayAddress?: string;
  provider?: string;
};
