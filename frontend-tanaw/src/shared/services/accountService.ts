import { queryKeys } from "../constants/queryKeys";
import { apiClient, getApiAccountId } from "../lib/apiClient";
import type { AccountSummary, AuthUser } from "../types";

export const currentUserQueryKey = queryKeys.currentUser;
export const accountPreferencesQueryKey = ["account-preferences"] as const;

export type AccountPreferences = {
  theme: "light" | "dark" | "system";
  textSize: "small" | "default" | "large" | "extra-large";
};

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
  const response = await apiClient.get<AccountPreferences>("/auth/preferences");
  return normalizeAccountPreferences(response.data);
}

// The API merges partial updates into one account record. Send theme and display changes in order.
let preferenceWrites = Promise.resolve();

export function updateAccountPreferences(preferences: Partial<AccountPreferences>) {
  const accountId = getApiAccountId();
  const write = preferenceWrites.then(async () => {
    if (!accountId || getApiAccountId() !== accountId) throw new Error("Account changed before preferences could be saved.");
    const response = await apiClient.patch<AccountPreferences>("/auth/preferences", preferences);
    return normalizeAccountPreferences(response.data);
  });
  preferenceWrites = write.then(() => undefined, () => undefined);
  return write;
}

function normalizeAccountPreferences(preferences: Partial<AccountPreferences>): AccountPreferences {
  return {
    theme: preferences.theme ?? "system",
    textSize: preferences.textSize ?? "default",
  };
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
