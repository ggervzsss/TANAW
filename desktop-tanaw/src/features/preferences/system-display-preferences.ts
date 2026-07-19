import { createContext, useContext } from "react";
import type { SystemTimeFormat } from "../../utils/date-time";

export type SystemDisplayPreferences = {
  timeFormat: SystemTimeFormat;
};

export const SystemDisplayPreferencesContext = createContext<SystemDisplayPreferences>({
  timeFormat: "12-hour",
});

export function useSystemDisplayPreferences() {
  return useContext(SystemDisplayPreferencesContext);
}
