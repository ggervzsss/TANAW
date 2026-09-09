import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { getAccountPreferences, updateAccountPreferences } from "@/shared/services/accountService";
import {
  applyThemePreference,
  chooseAuthenticatedThemePreference,
  getStoredThemePreference,
  getStoredThemePreferenceOrNull,
  persistThemePreference,
  resolveThemePreference,
} from "@/shared/utils/theme";
import type { ResolvedTheme, ThemePreference } from "@/shared/utils/theme";

export function usePortalThemePreference() {
  const [theme, setTheme] = useState<ThemePreference>(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemePreference(getStoredThemePreference()));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const skipNextSaveRef = useRef(true);
  const storedThemeAtMountRef = useRef<ThemePreference | null>(getStoredThemePreferenceOrNull());
  const themeRef = useRef(theme);
  const userSelectedThemeRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    void getAccountPreferences()
      .then((preferences) => {
        if (disposed) return;
        const localPreference = userSelectedThemeRef.current ? themeRef.current : storedThemeAtMountRef.current;
        const nextTheme = chooseAuthenticatedThemePreference(localPreference, preferences.theme);
        if (nextTheme !== themeRef.current) {
          themeRef.current = nextTheme;
          setTheme(nextTheme);
        }
        persistThemePreference(nextTheme);
        if (preferences.theme !== nextTheme) void updateAccountPreferences({ theme: nextTheme }).catch(() => undefined);
        setPreferencesLoaded(true);
      })
      .catch(() => {
        if (!disposed) setPreferencesLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
    const applyTheme = () => setResolvedTheme(applyThemePreference(theme));
    persistThemePreference(theme);
    applyTheme();
    if (theme !== "system") return undefined;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    void updateAccountPreferences({ theme }).catch(() => toast.error("Unable to save theme preference."));
  }, [preferencesLoaded, theme]);

  const toggleTheme = () => {
    userSelectedThemeRef.current = true;
    setTheme((currentTheme) => (resolveThemePreference(currentTheme) === "dark" ? "light" : "dark"));
  };

  return { resolvedTheme, toggleTheme };
}
