import { createContext, useContext } from "react";
import type { SystemTimeFormat } from "../utils/dateTime";

export type SystemDisplayPreferences = {
  timeFormat: SystemTimeFormat;
};

export { systemSettingsQueryKey } from "../services/systemSettingsService";

export const SystemDisplayPreferencesContext = createContext<SystemDisplayPreferences>({
  timeFormat: "12-hour",
});

export function useSystemDisplayPreferences() {
  return useContext(SystemDisplayPreferencesContext);
}
