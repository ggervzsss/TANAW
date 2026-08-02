export type ProfileChangeRequestType = "businessEmail" | "contactNumber";

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
  managerName: string | null;
  barangay: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: string | null;
  enterpriseId: string | null;
  gatewayStatus: string | null;
  buildingCapacity: number;
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
