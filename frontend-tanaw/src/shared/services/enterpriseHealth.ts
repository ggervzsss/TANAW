import type { ApiSchemas } from "@/contracts/api";
import { apiClient } from "../lib/apiClient";

/*
 * Enterprise health for IT and the Admin: whether each place's desktop app is sending data, its
 * cameras, and today's camera strip. Every enterprise account is listed, invited and deactivated
 * ones too.
 *
 * App status: online (data under 2 min old), delayed (2–10 min), offline (over 10 min or a desktop
 * error) or not_set_up (never sent). While a place is closed it is never offline; read `openNow`,
 * `closedReason` and `accountState` for those states.
 */

export type EnterpriseHealth = ApiSchemas["EnterpriseHealthSummary"];
export type EnterpriseAppHealth = EnterpriseHealth["app"];
export type CameraHealth = ApiSchemas["CameraHealth"];
export type EnterpriseHealthToday = ApiSchemas["EnterpriseHealthToday"];
export type CameraDayStrip = ApiSchemas["CameraDayStrip"];

export const enterpriseHealthQueryKey = ["enterprise-health"] as const;
export const enterpriseHealthDetailQueryKey = (enterpriseId: string) => ["enterprise-health", enterpriseId] as const;
export const enterpriseHealthTodayQueryKey = (enterpriseId: string) => ["enterprise-health", enterpriseId, "today"] as const;

export async function listEnterpriseHealth() {
  const response = await apiClient.get<EnterpriseHealth[]>("/operational/enterprise-health");
  return response.data;
}

/** One place by its enterprise ID (as on the map) or account ID. */
export async function getEnterpriseHealth(enterpriseId: string) {
  const response = await apiClient.get<EnterpriseHealth>(`/operational/enterprise-health/${encodeURIComponent(enterpriseId)}`);
  return response.data;
}

/** Today's hour-by-hour camera strip for one place. */
export async function getEnterpriseHealthToday(enterpriseId: string) {
  const response = await apiClient.get<EnterpriseHealthToday>(`/operational/enterprise-health/${encodeURIComponent(enterpriseId)}/today`);
  return response.data;
}
