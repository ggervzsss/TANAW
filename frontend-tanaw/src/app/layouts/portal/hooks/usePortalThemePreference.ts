import { useEffect, useLayoutEffect, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { getApiAccountId } from "@/shared/lib/apiClient";
import { getAccountPreferences, updateAccountPreferences } from "@/shared/services/accountService";
import {
  applyThemePreference,
  chooseAuthenticatedThemePreference,
  getStoredThemePreferenceOrNull,
  persistThemePreference,
  resolveThemePreference,
} from "@/shared/utils/theme";
import type { ThemePreference } from "@/shared/utils/theme";
import { transitionPortalTheme } from "@/shared/utils/themeTransition";

export function usePortalThemePreference() {
  const [storedThemeAtMount] = useState(getStoredThemePreferenceOrNull);
  const [theme, setTheme] = useState<ThemePreference>(storedThemeAtMount ?? "system");
  const [systemTheme, setSystemTheme] = useState(() => resolveThemePreference("system"));
  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const themeRef = useRef(theme);
  const userSelectedThemeRef = useRef(false);
  const switching = useRef(false);
  const queuedTheme = useRef<ThemePreference | null>(null);

  useEffect(() => {
    let disposed = false;
    void getAccountPreferences()
      .then((preferences) => {
        if (disposed || userSelectedThemeRef.current) return;
        const nextTheme = chooseAuthenticatedThemePreference(storedThemeAtMount, preferences.theme);
        if (nextTheme !== themeRef.current) {
          themeRef.current = nextTheme;
          setTheme(nextTheme);
        }
        persistThemePreference(nextTheme);
        if (preferences.theme !== nextTheme) {
          void updateAccountPreferences({ theme: nextTheme }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [storedThemeAtMount]);

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
          setSystemTheme(applyThemePreference("system"));
        }
      };
      void transitionPortalTheme(next, apply).catch(apply);
    };
    mediaQuery.addEventListener("change", onSystemChange);
    return () => mediaQuery.removeEventListener("change", onSystemChange);
  }, [theme]);

  const selectTheme = (next: ThemePreference) => {
    if (switching.current) {
      queuedTheme.current = next;
      return;
    }
    if (next === themeRef.current) return;
    userSelectedThemeRef.current = true;
    const accountId = getApiAccountId();
    const nextResolved = resolveThemePreference(next);
    const apply = () => {
      if (themeRef.current === next || getApiAccountId() !== accountId) return;
      themeRef.current = next;
      setTheme(next);
      const applied = applyThemePreference(next);
      persistThemePreference(next);
      if (next === "system") setSystemTheme(applied);
      void updateAccountPreferences({ theme: next }).catch(() => {
        if (getApiAccountId() === accountId) toast.error("Unable to sync theme preference to your account.");
      });
    };
    if (nextResolved === resolveThemePreference(themeRef.current)) {
      apply();
      return;
    }
    switching.current = true;
    void transitionPortalTheme(nextResolved, apply)
      .catch(apply)
      .finally(() => {
        switching.current = false;
        const pending = queuedTheme.current;
        queuedTheme.current = null;
        if (pending && getApiAccountId() === accountId) selectTheme(pending);
      });
  };

  return { theme, resolvedTheme, selectTheme };
}
