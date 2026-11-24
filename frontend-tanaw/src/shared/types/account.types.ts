import type { ApiSchemas } from "@/contracts/api";

export type ProfileChangeRequestType = "businessEmail" | "contactNumber" | "enterpriseName";

export type AccountProfileChangeRequest = {
  type: ProfileChangeRequestType;
  label: string;
  requestedValue: string;
  requestedAt: string | null;
  requestId: string | null;
  status: "pending_verification" | "verified" | "pending_review" | "expired";
  isVerified: boolean;
  canApprove: boolean;
  expiresAt: string | null;
};

export type AccountSummary = {
  id: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  enterpriseName: string | null;
  category: string | null;
  attraction?: ApiSchemas["AttractionClassification"] | null;
  attractionDescription?: string | null;
  managerName: string | null;
  barangay: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: string | null;
  enterpriseId: string | null;
  gatewayStatus: string | null;
  buildingCapacity: number;
  /** Per-day opening hours, entered by IT at account creation. */
  openingHours?: ApiSchemas["OpeningHours"] | null;
  displayName: string;
  role: string;
  title: string;
  status: "active" | "inactive";
  isActivated: boolean;
  isProtectedDefault: boolean;
  profileChangeRequests: AccountProfileChangeRequest[];
  createdAt: string;
  lastLoginAt: string | null;
};
