import { queryKeys } from "@/shared/constants/queryKeys";
import { apiClient } from "@/shared/lib/apiClient";
import type { AccountSummary } from "@/shared/types";

export type CreateLguAccountPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: "admin" | "it" | "staff";
};

export type UpdateLguAccountPayload = CreateLguAccountPayload;

export const lguAccountsQueryKey = queryKeys.lguAccounts;

export async function listLguAccounts() {
  const response = await apiClient.get<AccountSummary[]>("/accounts/lgu");
  return response.data;
}

export async function createLguAccount(payload: CreateLguAccountPayload) {
  const response = await apiClient.post<AccountSummary>("/accounts/lgu", payload);
  return response.data;
}

export async function updateLguAccount(accountId: string, payload: UpdateLguAccountPayload) {
  const response = await apiClient.patch<AccountSummary>(`/accounts/lgu/${accountId}`, payload);
  return response.data;
}
