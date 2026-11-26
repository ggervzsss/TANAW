import { createContext, useContext } from "react";
import type { SystemTimeFormat } from "../../utils/date-time";

export type TextSizePreference = "small" | "default" | "large" | "extra-large";
export type DisplayPreferences = {
  textSize: TextSizePreference;
};
export type PreferenceSaveStatus = "idle" | "saving" | "saved" | "error";

export const defaultDisplayPreferences: DisplayPreferences = {
  textSize: "default",
};

export const textSizeOptions: ReadonlyArray<{ value: TextSizePreference; label: string; description: string }> = [
  { value: "small", label: "Small", description: "Fits more text on screen." },
  { value: "default", label: "Default", description: "TANAW's standard text size." },
  { value: "large", label: "Large", description: "Makes text easier to read." },
  { value: "extra-large", label: "Extra Large", description: "Maximizes text legibility." },
];

export function textSizeRootValue(textSize: TextSizePreference) {
  if (textSize === "small") return "14px";
  if (textSize === "large") return "18px";
  if (textSize === "extra-large") return "20px";
  return "16px";
}

export function sameDisplayPreferences(left: DisplayPreferences, right: DisplayPreferences) {
  return left.textSize === right.textSize;
}

/** The display part of the account preferences, without the theme stored beside it. */
export function toDisplayPreferences(preferences: { textSize: TextSizePreference }): DisplayPreferences {
  return { textSize: preferences.textSize };
}

export type SystemDisplayPreferences = {
  timeFormat: SystemTimeFormat;
  displayPreferences: DisplayPreferences;
  saveStatus: PreferenceSaveStatus;
  updateDisplayPreferences: (patch: Partial<DisplayPreferences>) => void;
  resetDisplayPreferences: () => void;
  retryDisplayPreferencesSave: () => void;
};

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
