import { apiClient } from "@/shared/lib/apiClient";
import type { AuthUser } from "@/shared/types/role.types";

export type SessionResponse = {
  user: AuthUser;
  token: string;
};

export async function logoutSession(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function restoreSession(): Promise<SessionResponse> {
  const response = await apiClient.post<SessionResponse>("/auth/session");
  return response.data;
}
