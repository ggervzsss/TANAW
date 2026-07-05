export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const TANAW_THEME_STORAGE_KEY = "tanaw-web-theme";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const storedTheme = window.localStorage.getItem(TANAW_THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : "system";
}

export function persistThemePreference(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TANAW_THEME_STORAGE_KEY, theme);
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemePreference(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(theme);
  if (typeof document === "undefined") return resolvedTheme;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.dataset.themePreference = theme;

  return resolvedTheme;
}
