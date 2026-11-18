import { useSyncExternalStore } from "react";
import { getResolvedThemeSnapshot, subscribeToTheme, toggleThemePreference, type ResolvedTheme } from "../utils/theme";

export function useThemePreference() {
  const resolvedTheme = useSyncExternalStore<ResolvedTheme>(subscribeToTheme, getResolvedThemeSnapshot, () => "light");
  return { resolvedTheme, toggleTheme: toggleThemePreference };
}
