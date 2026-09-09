import { createContext, useContext } from "react";
import type { SystemTimeFormat } from "../utils/dateTime";

export type TextSizePreference = "small" | "default" | "large" | "extra-large";
export type InterfaceScalePreference = "compact" | "default" | "comfortable";
export type DisplayPreferences = {
  textSize: TextSizePreference;
  interfaceScale: InterfaceScalePreference;
};
export type PreferenceSaveStatus = "idle" | "saving" | "saved" | "error";

export const defaultDisplayPreferences: DisplayPreferences = {
  textSize: "default",
  interfaceScale: "default",
};

export function textSizeRootValue(textSize: TextSizePreference) {
  if (textSize === "small") return "14px";
  if (textSize === "large") return "18px";
  if (textSize === "extra-large") return "20px";
  return "16px";
}

export type SystemDisplayPreferences = {
  timeFormat: SystemTimeFormat;
  displayPreferences: DisplayPreferences;
  saveStatus: PreferenceSaveStatus;
  updateDisplayPreferences: (patch: Partial<DisplayPreferences>) => void;
  resetDisplayPreferences: () => void;
  retryDisplayPreferencesSave: () => void;
};

export { systemSettingsQueryKey } from "../services/systemSettingsService";

export const SystemDisplayPreferencesContext = createContext<SystemDisplayPreferences>({
  timeFormat: "12-hour",
  displayPreferences: defaultDisplayPreferences,
  saveStatus: "idle",
  updateDisplayPreferences: () => undefined,
  resetDisplayPreferences: () => undefined,
  retryDisplayPreferencesSave: () => undefined,
});

export function useSystemDisplayPreferences() {
  return useContext(SystemDisplayPreferencesContext);
}
