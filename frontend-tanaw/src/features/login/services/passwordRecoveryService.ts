import { apiClient } from "@/shared/lib/apiClient";

export type PasswordRecoveryRequest = {
  email: string;
};

export type PasswordRecoveryRequestResponse = {
  challengeId: string;
  expiresInMinutes: number;
  resendAvailableInSeconds: number;
  message: string;
};

export type PasswordRecoveryVerifyRequest = {
  challengeId: string;
  code: string;
};

export type PasswordRecoveryVerifyResponse = {
  resetToken: string;
};

export type PasswordRecoveryResetRequest = {
  challengeId: string;
  resetToken: string;
  newPassword: string;
};

export type PasswordRecoveryResetResponse = {
  status: string;
};

export async function requestPasswordRecovery(payload: PasswordRecoveryRequest): Promise<PasswordRecoveryRequestResponse> {
  const response = await apiClient.post<PasswordRecoveryRequestResponse>("/auth/forgot-password/request", payload);
  return response.data;
}

export async function verifyPasswordRecovery(payload: PasswordRecoveryVerifyRequest): Promise<PasswordRecoveryVerifyResponse> {
  const response = await apiClient.post<PasswordRecoveryVerifyResponse>("/auth/forgot-password/verify", payload);
  return response.data;
}

export async function resetRecoveredPassword(payload: PasswordRecoveryResetRequest): Promise<PasswordRecoveryResetResponse> {
  const response = await apiClient.post<PasswordRecoveryResetResponse>("/auth/forgot-password/reset", payload);
  return response.data;
}
