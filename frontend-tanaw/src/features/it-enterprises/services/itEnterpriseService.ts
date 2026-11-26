import { isAxiosError } from "axios";
import type { ApiSchemas } from "@/contracts/api";
import { enterpriseAccountsQueryKey } from "@/features/enterprise-accounts/services";
import { apiClient } from "@/shared/lib/apiClient";
import type { EnterpriseAccount } from "../model/enterprises";

export type PasswordResetSent = ApiSchemas["AccountPasswordResetSent"];

export function enterpriseAccountQueryKey(reference: string) {
  return [...enterpriseAccountsQueryKey, "detail", reference];
}

/** One enterprise account by its enterprise ID or account ID. */
export async function getEnterpriseAccount(reference: string) {
  const response = await apiClient.get<EnterpriseAccount>(`/accounts/enterprises/${encodeURIComponent(reference)}`);
  return response.data;
}

/** Emails the owner the same password-recovery code they would get from Forgot password. */
export async function sendPasswordReset(accountId: string) {
  const response = await apiClient.post<PasswordResetSent>(`/accounts/${encodeURIComponent(accountId)}/password-reset`);
  return response.data;
}

/** Seconds to wait after a 429 from the password reset endpoint, or null for any other error. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!isAxiosError(error) || error.response?.status !== 429) return null;
  const detail: unknown = (error.response.data as { detail?: unknown } | undefined)?.detail;
  if (detail && typeof detail === "object" && "retryAfterSeconds" in detail) {
    const seconds = Number(detail.retryAfterSeconds);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  const header = Number(error.response.headers?.["retry-after"]);
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : 60;
}

/** True when the request failed because the enterprise does not exist. */
export function isNotFound(error: unknown) {
  return isAxiosError(error) && error.response?.status === 404;
}
