import { queryKeys } from "@/shared/constants/queryKeys";
import { apiClient } from "@/shared/lib/apiClient";
import type { AccountSummary, ProfileChangeRequestType } from "@/shared/types";
import type { EnterpriseLocationSuggestion } from "../types";

export type CreateEnterpriseAccountPayload = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactNumber?: string;
  barangay: string;
  address: string;
  enterpriseId?: string;
  latitude: number;
  longitude: number;
  buildingCapacity: number;
};

export type UpdateEnterpriseAccountPayload = {
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactNumber?: string;
  barangay: string;
  address: string;
  buildingCapacity: number;
  latitude?: number;
  longitude?: number;
};

export const enterpriseAccountsQueryKey = queryKeys.enterpriseAccounts;

export async function listEnterpriseAccounts() {
  const response = await apiClient.get<AccountSummary[]>("/accounts/enterprises");
  return response.data;
}

export async function createEnterpriseAccount(payload: CreateEnterpriseAccountPayload) {
  const response = await apiClient.post<AccountSummary>("/accounts/enterprises", payload);
  return response.data;
}

export async function updateEnterpriseAccount(accountId: string, payload: UpdateEnterpriseAccountPayload) {
  const response = await apiClient.patch<AccountSummary>(`/accounts/enterprises/${accountId}`, payload);
  return response.data;
}

export async function searchEnterpriseLocations(query: string, signal?: AbortSignal) {
  const response = await apiClient.get<EnterpriseLocationSuggestion[]>("/accounts/enterprises/location-suggestions", {
    params: { query },
    signal,
  });
  return response.data;
}

export async function resolveEnterpriseProfileChangeRequest(accountId: string, requestType: ProfileChangeRequestType, action: "approve" | "decline") {
  const response = await apiClient.patch<AccountSummary>(`/accounts/enterprises/${accountId}/profile-change-requests/${requestType}`, { action });
  return response.data;
}
