import type { ApiSchemas } from "../../contracts/api";
import { staffApi } from "../../lib/axios";

export type AccountPreferences = ApiSchemas["AccountPreferences"];

export async function getAccountPreferences() {
  const response = await staffApi.get<AccountPreferences>("/auth/preferences");
  return normalizeAccountPreferences(response.data);
}

export async function updateAccountPreferences(preferences: Partial<AccountPreferences>) {
  const response = await staffApi.patch<AccountPreferences>("/auth/preferences", preferences);
  return normalizeAccountPreferences(response.data);
}

function normalizeAccountPreferences(preferences: Partial<AccountPreferences>): AccountPreferences {
  return {
    theme: preferences.theme ?? "system",
    textSize: preferences.textSize ?? "default",
    interfaceScale: preferences.interfaceScale ?? "default",
  };
}
