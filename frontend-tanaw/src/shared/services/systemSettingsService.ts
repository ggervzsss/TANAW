import { queryKeys } from "../constants/queryKeys";
import { apiClient } from "../lib/apiClient";

export type SystemSettingValue = string | boolean | number;

export type SystemSettingsResponse = {
  updatedAt: string | null;
  updatedBy: string | null;
  values: Record<string, SystemSettingValue>;
};

export const systemSettingsQueryKey = queryKeys.systemSettings;

export async function getSystemSettings() {
  const response = await apiClient.get<SystemSettingsResponse>("/auth/system-settings");
  return response.data;
}

export async function updateSystemSettings(values: Record<string, SystemSettingValue>) {
  const response = await apiClient.patch<SystemSettingsResponse>("/auth/system-settings", { values });
  return response.data;
}
