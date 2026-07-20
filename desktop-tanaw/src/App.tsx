import { useEffect } from "react";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router/AppRouter";
import { applyThemePreference, getInitialThemePreference } from "./features/security/utils/theme";

export default function App() {
  useEffect(() => {
    const theme = getInitialThemePreference();
    const applyStoredTheme = () => applyThemePreference(theme);

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
