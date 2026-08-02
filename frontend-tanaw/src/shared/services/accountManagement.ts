import { apiClient } from "../lib/apiClient";
import type { AuthUser } from "../types/role.types";

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

export type DevDelivery = {
  id: string;
  accountId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
};

export type CreateLguAccountPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: "admin" | "it" | "staff";
};

export type UpdateLguAccountPayload = CreateLguAccountPayload;

export type CreateEnterpriseAccountPayload = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactNumber?: string;
  barangay: string;
  address: string;
  enterpriseId?: string;
  latitude: number;
  longitude: number;
  buildingCapacity: number;
};

export type SystemSettingValue = string | boolean | number;

export type SystemSettingsResponse = {
  updatedAt: string | null;
  updatedBy: string | null;
  values: Record<string, SystemSettingValue>;
};

export type UpdateEnterpriseAccountPayload = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactNumber?: string;
  barangay: string;
  address: string;
  buildingCapacity: number;
  latitude?: number;
  longitude?: number;
};

export async function listLguAccounts() {
  const response = await apiClient.get<AccountSummary[]>("/accounts/lgu");
  return response.data;
}

export async function createLguAccount(payload: CreateLguAccountPayload) {
  const response = await apiClient.post<AccountSummary>("/accounts/lgu", payload);
  return response.data;
}

export async function updateLguAccount(accountId: string, payload: UpdateLguAccountPayload) {
  const response = await apiClient.patch<AccountSummary>(`/accounts/lgu/${accountId}`, payload);
  return response.data;
}

export async function listEnterpriseAccounts() {
  const response = await apiClient.get<AccountSummary[]>("/accounts/enterprises");
  return response.data;
}

export async function createEnterpriseAccount(payload: CreateEnterpriseAccountPayload) {
  const response = await apiClient.post<AccountSummary>("/accounts/enterprises", payload);
  return response.data;
}

export async function updateEnterpriseAccount(accountId: string, payload: UpdateEnterpriseAccountPayload) {
  const response = await apiClient.patch<AccountSummary>(`/accounts/enterprises/${accountId}`, payload);
  return response.data;
}

export async function resolveEnterpriseProfileChangeRequest(accountId: string, requestType: ProfileChangeRequestType, action: "approve" | "decline") {
  const response = await apiClient.patch<AccountSummary>(`/accounts/enterprises/${accountId}/profile-change-requests/${requestType}`, { action });
  return response.data;
}

export async function resolveAccountEmailChangeRequest(accountId: string, action: "approve" | "decline") {
  const response = await apiClient.patch<AccountSummary>(`/accounts/${accountId}/email-change-request`, { action });
  return response.data;
}

export async function resendAccountActivation(accountId: string) {
  const response = await apiClient.post<AccountSummary>(`/accounts/${accountId}/activation`);
  return response.data;
}

export async function updateAccountStatus(accountId: string, status: "active" | "inactive") {
  const response = await apiClient.patch<AccountSummary>(`/accounts/${accountId}/status`, { status });
  return response.data;
}

export async function listDevDeliveries() {
  const response = await apiClient.get<DevDelivery[]>("/dev/deliveries");
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await apiClient.post("/auth/change-password", { currentPassword, newPassword });
  return response.data as { token: string; user: AuthUser };
}

export async function getCurrentUser() {
  const response = await apiClient.get<AuthUser>("/auth/me");
  return response.data;
}

export type ProfileUpdatePayload = {
  firstName?: string;
  lastName?: string;
  managerName?: string;
  email: string;
  phone?: string;
  enterpriseName?: string;
  address?: string;
  displayImageDataUrl?: string | null;
};

export async function updateCurrentProfile(payload: ProfileUpdatePayload) {
  const response = await apiClient.patch<AuthUser>("/auth/profile", payload);
  return response.data;
}

export async function getAccountPreferences() {
  const response = await apiClient.get<{ theme: "light" | "dark" | "system" }>("/auth/preferences");
  return response.data;
}

export async function updateAccountPreferences(theme: "light" | "dark" | "system") {
  const response = await apiClient.patch<{ theme: "light" | "dark" | "system" }>("/auth/preferences", { theme });
  return response.data;
}

export async function getSystemSettings() {
  const response = await apiClient.get<SystemSettingsResponse>("/auth/system-settings");
  return response.data;
}

export async function updateSystemSettings(values: Record<string, SystemSettingValue>) {
  const response = await apiClient.patch<SystemSettingsResponse>("/auth/system-settings", { values });
  return response.data;
}
