import { transitionTheme } from "./theme-transition";
import type { ThemePreference } from "../../../types/enterprise";

export const ENTERPRISE_THEME_STORAGE_KEY = "tanaw-enterprise-theme";
export type ResolvedTheme = "light" | "dark";
const listeners = new Set<() => void>();
let requestedTheme: ResolvedTheme | undefined;

export const isThemePreference = (value: string | null): value is ThemePreference => value === "light" || value === "dark" || value === "system";
export const getInitialThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(ENTERPRISE_THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
};
export const persistThemePreference = (theme: ThemePreference) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENTERPRISE_THEME_STORAGE_KEY, theme);
  } catch {
    /* Applying the theme does not depend on storage availability. */
  }
};
export const resolveThemePreference = (theme: ThemePreference): ResolvedTheme => {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
export const getResolvedThemeSnapshot = (): ResolvedTheme => {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};
export const getThemePreferenceSnapshot = (): ThemePreference => {
  const applied = typeof document === "undefined" ? null : document.documentElement.dataset.enterpriseTheme ?? null;
  return isThemePreference(applied) ? applied : getInitialThemePreference();
};
export const subscribeToTheme = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function changeTheme(theme: ThemePreference, animate: boolean, persist: boolean): ResolvedTheme {
  const resolved = resolveThemePreference(theme);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  const changed = getResolvedThemeSnapshot() !== resolved;
  requestedTheme = resolved;
  transitionTheme(() => {
    root.classList.toggle("dark", resolved === "dark");
    root.classList.toggle("light", resolved === "light");
    root.dataset.enterpriseTheme = theme;
    root.style.colorScheme = resolved;
    root.style.backgroundColor = resolved === "dark" ? "#151b21" : "";
    if (persist) persistThemePreference(theme);
    for (const listener of listeners) listener();
    requestedTheme = undefined;
  }, animate && changed);
  return resolved;
}
export const applyThemePreference = (theme: ThemePreference, animate = false): ResolvedTheme => changeTheme(theme, animate, false);
export const setThemePreference = (theme: ThemePreference) => changeTheme(theme, true, true);
export const toggleThemePreference = () => setThemePreference((requestedTheme ?? getResolvedThemeSnapshot()) === "dark" ? "light" : "dark");

/** One application-level observer avoids stale system-mode listeners after a manual toggle. */
export const observeThemePreference = () => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemChanged = () => {
    if (document.documentElement.dataset.enterpriseTheme !== "system") return;
    applyThemePreference("system", true);
  };
  const storedChanged = (event: StorageEvent) => {
    if (event.key !== ENTERPRISE_THEME_STORAGE_KEY && event.key !== null) return;
    applyThemePreference(getInitialThemePreference(), true);
  };
  media.addEventListener("change", systemChanged);
  window.addEventListener("storage", storedChanged);
  return () => {
    media.removeEventListener("change", systemChanged);
    window.removeEventListener("storage", storedChanged);
  };
};
