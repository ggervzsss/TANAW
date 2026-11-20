import { useSyncExternalStore } from "react";
import type { ThemePreference } from "../../../types/enterprise";
import { getResolvedThemeSnapshot, getThemePreferenceSnapshot, setThemePreference, subscribeToTheme, toggleThemePreference, type ResolvedTheme } from "../utils/theme";

export function useThemePreference() {
  const resolvedTheme = useSyncExternalStore<ResolvedTheme>(subscribeToTheme, getResolvedThemeSnapshot, () => "light");
  const theme = useSyncExternalStore<ThemePreference>(subscribeToTheme, getThemePreferenceSnapshot, () => "light");
  return { theme, resolvedTheme, selectTheme: setThemePreference, toggleTheme: toggleThemePreference };
}
