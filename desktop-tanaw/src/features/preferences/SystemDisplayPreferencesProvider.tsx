import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { staffApi } from "../../lib/axios";
import { resolveSystemTimeFormat } from "../../utils/date-time";
import { useAuthStore } from "../login/stores/auth-store";
import { SystemDisplayPreferencesContext } from "./system-display-preferences";

type SystemSettingsResponse = {
  values: Record<string, string | boolean | number>;
};

export function SystemDisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const settingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: getSystemSettings,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const timeFormat = resolveSystemTimeFormat(settingsQuery.data?.values["display.timeFormat"]);

  return <SystemDisplayPreferencesContext.Provider value={{ timeFormat }}>{children}</SystemDisplayPreferencesContext.Provider>;
}

async function getSystemSettings() {
  const response = await staffApi.get<SystemSettingsResponse>("/auth/system-settings");
  return response.data;
}
