import type { ApiSchemas } from "@/contracts/api";
import { apiClient } from "@/shared/lib/apiClient";
import type { SessionResponse } from "@/shared/services/sessionService";
import type { AuthUser } from "@/shared/types/role.types";

export type CurrentSession = ApiSchemas["CurrentSessionResponse"];
export type TwoFactorSetup = ApiSchemas["TwoFactorSetupResponse"];
export type TwoFactorConfirmation = Omit<ApiSchemas["TwoFactorConfirmResponse"], "user"> & { user: AuthUser };

export const currentSessionQueryKey = ["account-security", "current-session"] as const;

/** When this device signed in. */
export async function getCurrentSession(): Promise<CurrentSession> {
  const response = await apiClient.get<CurrentSession>("/auth/sessions/current");
  return response.data;
}

/** Ends every other session; this device continues with the fresh session returned. */
export async function signOutOtherSessions(): Promise<SessionResponse> {
  const response = await apiClient.post<SessionResponse>("/auth/sessions/revoke-others");
  return response.data;
}

export async function startTwoFactorSetup(): Promise<TwoFactorSetup> {
  const response = await apiClient.post<TwoFactorSetup>("/auth/two-factor/setup");
  return response.data;
}

export async function confirmTwoFactorSetup(code: string): Promise<TwoFactorConfirmation> {
  const response = await apiClient.post<TwoFactorConfirmation>("/auth/two-factor/confirm", { code });
  return response.data;
}

export async function disableTwoFactor(currentPassword: string): Promise<AuthUser> {
  const response = await apiClient.post<AuthUser>("/auth/two-factor/disable", { currentPassword });
  return response.data;
}
