import { useEffect } from "react";
import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./routers/AppRouter";
import { applyThemePreference, getStoredThemePreference } from "@/shared/utils/theme";

function App() {
  useEffect(() => {
    const theme = getStoredThemePreference();
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

export default App;
