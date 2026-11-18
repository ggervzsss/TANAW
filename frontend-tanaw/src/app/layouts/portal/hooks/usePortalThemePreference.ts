import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type { ThemePreference } from "@/shared/utils/theme";
import { transitionPortalTheme } from "@/shared/utils/themeTransition";

export function usePortalThemePreference(animateTheme: boolean) {
  const [theme, setTheme] = useState<ThemePreference>(getStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState(() => resolveThemePreference("system"));
  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const skipNextSaveRef = useRef(true);
  const storedThemeAtMountRef = useRef<ThemePreference | null>(getStoredThemePreferenceOrNull());
  const themeRef = useRef(theme);
  const userSelectedThemeRef = useRef(false);
  const switching = useRef(false);
  const [isSwitchingTheme, setIsSwitchingTheme] = useState(false);

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

  useLayoutEffect(() => {
    themeRef.current = theme;
    persistThemePreference(theme);
    applyThemePreference(theme);
    if (theme !== "system") return undefined;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      const next = resolveThemePreference("system");
      const apply = () => {
        if (themeRef.current === "system") {
          applyThemePreference("system");
          setSystemTheme(next);
        }
      };
      if (animateTheme) void transitionPortalTheme(next, apply).catch(apply);
      else apply();
    };
    mediaQuery.addEventListener("change", onSystemChange);
    return () => mediaQuery.removeEventListener("change", onSystemChange);
  }, [animateTheme, theme]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    void updateAccountPreferences({ theme }).catch(() => toast.error("Unable to save theme preference."));
  }, [preferencesLoaded, theme]);

  const toggleTheme = () => {
    if (switching.current) return;
    userSelectedThemeRef.current = true;
    const next = resolveThemePreference(themeRef.current) === "dark" ? "light" : "dark";
    if (!animateTheme) {
      setTheme(next);
      return;
    }

    switching.current = true;
    setIsSwitchingTheme(true);
    const apply = () => {
      themeRef.current = next;
      setTheme(next);
      applyThemePreference(next);
      persistThemePreference(next);
    };
    void transitionPortalTheme(next, apply)
      .catch(apply)
      .finally(() => {
        switching.current = false;
        setIsSwitchingTheme(false);
      });
  };

  return { resolvedTheme, toggleTheme, isSwitchingTheme };
}
