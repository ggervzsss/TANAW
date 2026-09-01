import { staffApi } from "../../../lib/axios";
import { apiPaths, type ApiAuthUser, type ApiLoginResponse } from "../../../contracts/api";
import type { LoginFormValues } from "../schemas/login-schema";
import type { LoginResponse } from "../types";

const SESSION_RESTORE_TIMEOUT_MS = 3500;

function normalizeSession(response: ApiLoginResponse): LoginResponse {
  return {
    ...response,
    user: {
      ...response.user,
      name: response.user.displayName ?? response.user.enterpriseName ?? "Enterprise User",
      role: normalizeEnterpriseRole(response.user),
    },
  };
}

export async function login(credentials: LoginFormValues, rememberMe = false) {
  const response = await staffApi.post<ApiLoginResponse>(apiPaths.authLogin, {
    ...credentials,
    loginScope: "enterprise",
    rememberMe,
  });

  return normalizeSession(response.data);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await staffApi.post<ApiLoginResponse>("/auth/change-password", { currentPassword, newPassword });

  return normalizeSession(response.data);
}

export async function getCurrentUser() {
  const response = await staffApi.get<ApiAuthUser>("/auth/me");

  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateProfileImage(displayImageDataUrl: string | null) {
  const response = await staffApi.patch<ApiAuthUser>("/auth/profile/display-image", { displayImageDataUrl });
  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateLeadAdminName(managerName: string) {
  const response = await staffApi.patch<ApiAuthUser>("/auth/profile/lead-admin", { managerName });
  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateBuildingCapacity(buildingCapacity: number) {
  const response = await staffApi.patch<ApiAuthUser>("/auth/profile/building-capacity", { buildingCapacity });
  return normalizeSession({ token: "", user: response.data }).user;
}

export async function requestBusinessEmailChange(email: string) {
  const response = await staffApi.post<{ status: string; message: string }>("/auth/profile/business-email-change", { email });
  return response.data;
}

export type BusinessEmailChangeStatus = {
  requestId: string;
  requestedEmail: string;
  status: "pending_verification" | "verified" | "expired";
  isVerified: boolean;
  expiresAt: string;
};

export async function getBusinessEmailChangeStatus() {
  const response = await staffApi.get<BusinessEmailChangeStatus | null>("/auth/profile/business-email-change");
  return response.data;
}

export async function cancelBusinessEmailChange() {
  const response = await staffApi.delete<{ status: string; message: string }>("/auth/profile/business-email-change");
  return response.data;
}

export async function requestContactNumberChange(phone: string) {
  const response = await staffApi.post<{ status: string; message: string }>("/auth/profile/contact-number-change", { phone });
  return response.data;
}

export async function logout() {
  await staffApi.post(apiPaths.authLogout);
}

export async function restoreSession(token: string) {
  const response = await staffApi.post<ApiLoginResponse>(
    apiPaths.authSession,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: SESSION_RESTORE_TIMEOUT_MS,
    },
  );
  return normalizeSession(response.data);
}

function normalizeEnterpriseRole(user: ApiAuthUser): "enterprise" {
  if (user.role !== "enterprise") {
    throw new Error("The enterprise desktop received a non-enterprise session.");
  }
  return user.role;
}
