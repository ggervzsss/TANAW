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

export async function login(credentials: LoginFormValues) {
  const response = await staffApi.post<LoginResponse>("/auth/login", {
    ...credentials,
    loginScope: "enterprise",
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

export async function updateCurrentProfile(payload: { managerName: string; email: string; phone?: string; enterpriseName: string; address?: string; displayImageDataUrl?: string | null }) {
  const response = await staffApi.patch<LoginResponse["user"]>("/auth/profile", payload);
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

export async function requestBusinessEmailChange(email: string) {
  const response = await staffApi.post<{ status: string; message: string }>("/auth/profile/business-email-change", { email });
  return response.data;
}

export async function requestContactNumberChange(phone: string) {
  const response = await staffApi.post<{ status: string; message: string }>("/auth/profile/contact-number-change", { phone });
  return response.data;
}

export async function requestDataArchive() {
  const response = await staffApi.post<{ status: string }>("/auth/data-archive");
  return response.data;
}

export async function logout() {
  await staffApi.post("/auth/logout");
}
