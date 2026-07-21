import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { getSystemSettings } from "../services/accountManagement";
import { resolveSystemTimeFormat } from "../utils/dateTime";
import { systemSettingsQueryKey, SystemDisplayPreferencesContext } from "./systemDisplayPreferences";

export function SystemDisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const settingsQuery = useQuery({
    queryKey: systemSettingsQueryKey,
    queryFn: getSystemSettings,
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const timeFormat = resolveSystemTimeFormat(settingsQuery.data?.values["display.timeFormat"]);

  return <SystemDisplayPreferencesContext.Provider value={{ timeFormat }}>{children}</SystemDisplayPreferencesContext.Provider>;
}
