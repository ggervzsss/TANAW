import type { AuthUser } from "@/shared/types/role.types";
import { apiClient } from "@/shared/lib/apiClient";

export type LoginCredentials = {
  clientId: string;
  encryptionKey: string;
};

export type LoginServiceResponse = {
  user: AuthUser;
  token: string;
};

export async function loginService(_credentials: LoginCredentials): Promise<LoginServiceResponse> {
  const response = await apiClient.post<LoginServiceResponse>("/auth/login", {
    username: _credentials.clientId,
    password: _credentials.encryptionKey,
    loginScope: "web",
  });

  return response.data;
}

export async function logoutService(): Promise<void> {
  await apiClient.post("/auth/logout");
}
