export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const TANAW_THEME_STORAGE_KEY = "tanaw-web-theme";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredThemePreferenceOrNull(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  const storedTheme = window.localStorage.getItem(TANAW_THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : null;
}

export function getStoredThemePreference(): ThemePreference {
  return getStoredThemePreferenceOrNull() ?? "system";
}

export function persistThemePreference(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TANAW_THEME_STORAGE_KEY, theme);
}

export function chooseAuthenticatedThemePreference(localPreference: ThemePreference | null, accountPreference: ThemePreference): ThemePreference {
  return localPreference ?? accountPreference;
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
