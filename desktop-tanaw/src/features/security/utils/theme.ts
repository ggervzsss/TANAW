import type { ThemePreference } from "../../../types/enterprise";

export const ENTERPRISE_THEME_STORAGE_KEY = "tanaw-enterprise-theme";
export type ResolvedTheme = "light" | "dark";

export const isThemePreference = (value: string | null): value is ThemePreference => value === "light" || value === "dark" || value === "system";

export const getInitialThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem(ENTERPRISE_THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : "light";
};

export const persistThemePreference = (theme: ThemePreference) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENTERPRISE_THEME_STORAGE_KEY, theme);
};

export const resolveThemePreference = (theme: ThemePreference): ResolvedTheme => {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const applyThemePreference = (theme: ThemePreference): ResolvedTheme => {
  const resolvedTheme = resolveThemePreference(theme);
  if (typeof document === "undefined") return resolvedTheme;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.dataset.enterpriseTheme = theme;

  return resolvedTheme;
};
