import { useEffect } from "react";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router/AppRouter";
import { ENTERPRISE_THEME_STORAGE_KEY, getInitialThemePreference, resolveThemePreference } from "./features/security/utils/theme";

export default function App() {
  useEffect(() => {
    const theme = getInitialThemePreference();
    const applyStoredTheme = () => {
      const resolvedTheme = resolveThemePreference(theme);
      const root = window.document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolvedTheme);
      root.dataset.enterpriseTheme = theme;
    };

    window.localStorage.setItem(ENTERPRISE_THEME_STORAGE_KEY, theme);
    applyStoredTheme();

    if (theme !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyStoredTheme);
    return () => mediaQuery.removeEventListener("change", applyStoredTheme);
  }, []);

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
