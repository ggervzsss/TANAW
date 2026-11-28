import type { UserRole } from "@/shared/types/role.types";
import { apiPaths, type ApiSchemas } from "@/contracts/api";
import { apiClient } from "@/shared/lib/apiClient";
import type { SessionResponse } from "@/shared/services/sessionService";

export type LoginCredentials = {
  clientId: string;
  encryptionKey: string;
  rememberMe?: boolean;
};

export type LoginServiceResponse = SessionResponse;

/** The password was right and the account uses two-step verification: a code is needed next. */
export type TwoFactorLoginChallenge = ApiSchemas["TwoFactorChallengeResponse"];

export type TwoFactorLoginVerification = { challengeToken: string } & ({ code: string; recoveryCode?: never } | { recoveryCode: string; code?: never });

export type AccountActivationDetails = {
  displayName: string;
  role: UserRole;
  expiresAt: string;
};

export function isTwoFactorLoginChallenge(response: LoginServiceResponse | TwoFactorLoginChallenge): response is TwoFactorLoginChallenge {
  return "twoFactorRequired" in response && response.twoFactorRequired === true;
}

export async function loginService(_credentials: LoginCredentials): Promise<LoginServiceResponse | TwoFactorLoginChallenge> {
  const response = await apiClient.post<LoginServiceResponse | TwoFactorLoginChallenge>(apiPaths.authLogin, {
    username: _credentials.clientId,
    password: _credentials.encryptionKey,
    loginScope: "web",
    rememberMe: _credentials.rememberMe ?? false,
  });

  return response.data;
}

/** The second sign-in step: a code from the authenticator app, or a one-time recovery code. */
export async function verifyTwoFactorLogin(verification: TwoFactorLoginVerification): Promise<LoginServiceResponse> {
  const response = await apiClient.post<LoginServiceResponse>("/auth/login/two-factor", verification);
  return response.data;
}

export async function validateAccountActivation(token: string): Promise<AccountActivationDetails> {
  const response = await apiClient.post<AccountActivationDetails>("/auth/account-activation/validate", { token });
  return response.data;
}

export async function completeAccountActivation(token: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/account-activation/complete", { token, newPassword });
}
