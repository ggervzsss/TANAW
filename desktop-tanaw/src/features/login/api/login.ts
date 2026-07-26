import { staffApi } from "../../../lib/axios";
import type { LoginFormValues } from "../schemas/login-schema";
import type { LoginResponse } from "../types";
function normalizeSession(response: LoginResponse): LoginResponse {
  return {
    ...response,
    user: {
      ...response.user,
      name: response.user.name ?? response.user.displayName ?? response.user.enterpriseName ?? "Enterprise User",
    },
  };
}

export async function login(credentials: LoginFormValues, rememberMe = false) {
  const response = await staffApi.post<LoginResponse>("/auth/login", {
    ...credentials,
    loginScope: "enterprise",
    rememberMe,
  });

  return normalizeSession(response.data);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await staffApi.post<LoginResponse>("/auth/change-password", { currentPassword, newPassword });

  return normalizeSession(response.data);
}

export async function getCurrentUser() {
  const response = await staffApi.get<LoginResponse["user"]>("/auth/me");

  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateProfileImage(displayImageDataUrl: string | null) {
  const response = await staffApi.patch<LoginResponse["user"]>("/auth/profile/display-image", { displayImageDataUrl });
  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateLeadAdminName(managerName: string) {
  const response = await staffApi.patch<LoginResponse["user"]>("/auth/profile/lead-admin", { managerName });
  return normalizeSession({ token: "", user: response.data }).user;
}

export async function updateBuildingCapacity(buildingCapacity: number) {
  const response = await staffApi.patch<LoginResponse["user"]>("/auth/profile/building-capacity", { buildingCapacity });
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
  await staffApi.post("/auth/logout");
}

export async function restoreSession(token?: string) {
  const response = await staffApi.post<LoginResponse>("/auth/session", {}, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  return normalizeSession(response.data);
}
