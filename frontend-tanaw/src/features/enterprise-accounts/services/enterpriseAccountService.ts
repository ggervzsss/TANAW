import type { ApiSchemas } from "@/contracts/api";
import { queryKeys } from "@/shared/constants/queryKeys";
import { apiClient } from "@/shared/lib/apiClient";
import type { AccountSummary } from "@/shared/types";
import type { EnterpriseLocationSuggestion } from "../types";

export type CreateEnterpriseAccountPayload = ApiSchemas["EnterpriseAccountCreate"];
export type UpdateEnterpriseAccountPayload = ApiSchemas["EnterpriseAccountUpdate"];

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


export type EnterpriseClosure = ApiSchemas["ClosureSummary"];
export type EnterpriseClosureCreate = ApiSchemas["ClosureCreate"];

export function enterpriseClosuresQueryKey(accountId: string) {
  return [...enterpriseAccountsQueryKey, accountId, "closures"];
}

/** Dates a place is temporarily closed, so it is never shown as offline then. */
export async function listEnterpriseClosures(accountId: string) {
  const response = await apiClient.get<EnterpriseClosure[]>(`/accounts/enterprises/${accountId}/closures`);
  return response.data;
}

export async function addEnterpriseClosure(accountId: string, closure: EnterpriseClosureCreate) {
  const response = await apiClient.post<EnterpriseClosure>(`/accounts/enterprises/${accountId}/closures`, closure);
  return response.data;
}

export async function removeEnterpriseClosure(accountId: string, closureId: string) {
  await apiClient.delete(`/accounts/enterprises/${accountId}/closures/${closureId}`);
}
