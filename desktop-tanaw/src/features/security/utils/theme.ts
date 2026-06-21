import type { ThemePreference } from "../../../types/enterprise";

export const ENTERPRISE_THEME_STORAGE_KEY = "tanaw-enterprise-theme";

export const isThemePreference = (value: string | null): value is ThemePreference => value === "light" || value === "dark" || value === "system";

export const getInitialThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem(ENTERPRISE_THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : "light";
};

export const resolveThemePreference = (theme: ThemePreference) => {
  if (theme !== "system") return theme;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
