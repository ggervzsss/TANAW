import type { AuthUser, UserRole } from "@/shared/types/role.types";
import { apiClient } from "@/shared/lib/apiClient";

export type LoginCredentials = {
  clientId: string;
  encryptionKey: string;
  rememberMe?: boolean;
};

export type LoginServiceResponse = {
  user: AuthUser;
  token: string;
};

export type AccountActivationDetails = {
  displayName: string;
  role: UserRole;
  expiresAt: string;
};

export async function loginService(_credentials: LoginCredentials): Promise<LoginServiceResponse> {
  const response = await apiClient.post<LoginServiceResponse>("/auth/login", {
    username: _credentials.clientId,
    password: _credentials.encryptionKey,
    loginScope: "web",
    rememberMe: _credentials.rememberMe ?? false,
  });

  return response.data;
}

export async function logoutService(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function restoreSessionService(): Promise<LoginServiceResponse> {
  const response = await apiClient.post<LoginServiceResponse>("/auth/session");
  return response.data;
}

export async function validateAccountActivation(token: string): Promise<AccountActivationDetails> {
  const response = await apiClient.post<AccountActivationDetails>("/auth/account-activation/validate", { token });
  return response.data;
}

export async function completeAccountActivation(token: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/account-activation/complete", { token, newPassword });
}
