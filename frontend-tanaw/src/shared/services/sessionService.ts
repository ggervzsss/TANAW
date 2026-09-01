import { apiClient } from "@/shared/lib/apiClient";
import { apiPaths, type ApiLoginResponse } from "@/contracts/api";
import type { AuthUser } from "@/shared/types/role.types";

export type SessionResponse = Omit<ApiLoginResponse, "user"> & {
  user: AuthUser;
};

export async function logoutSession(): Promise<void> {
  await apiClient.post(apiPaths.authLogout);
}

export async function restoreSession(): Promise<SessionResponse> {
  const response = await apiClient.post<SessionResponse>(apiPaths.authSession);
  return response.data;
}
