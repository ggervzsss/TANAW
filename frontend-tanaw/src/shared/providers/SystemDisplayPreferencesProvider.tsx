import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getSystemSettings } from "../services/systemSettingsService";
import { resolveSystemTimeFormat } from "../utils/dateTime";
import { systemSettingsQueryKey, SystemDisplayPreferencesContext } from "./systemDisplayPreferences";

export function SystemDisplayPreferencesProvider({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
  const settingsQuery = useQuery({
    queryKey: systemSettingsQueryKey,
    queryFn: getSystemSettings,
    enabled: authenticated,
    staleTime: 60_000,
  });
  const timeFormat = resolveSystemTimeFormat(settingsQuery.data?.values["display.timeFormat"]);

  return <SystemDisplayPreferencesContext.Provider value={{ timeFormat }}>{children}</SystemDisplayPreferencesContext.Provider>;
}
