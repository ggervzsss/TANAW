import { queryKeys } from "../constants/queryKeys";
import { apiClient } from "../lib/apiClient";
import type { AccountSummary, AuthUser } from "../types";

export const currentUserQueryKey = queryKeys.currentUser;
export const accountPreferencesQueryKey = ["account-preferences"] as const;

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

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await apiClient.post("/auth/change-password", { currentPassword, newPassword });
  return response.data as { token: string; user: AuthUser };
}

export async function getCurrentUser() {
  const response = await apiClient.get<AuthUser>("/auth/me");
  return response.data;
}

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
