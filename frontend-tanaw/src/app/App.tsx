import { useEffect } from "react";
import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./routers/AppRouter";
import { useReportStore } from "./store/reportStore";
import { applyThemePreference, getStoredThemePreference } from "@/shared/utils/theme";

function App() {
  const syncCurrentSubmissionPeriod = useReportStore((state) => state.syncCurrentSubmissionPeriod);

  useEffect(() => {
    const theme = getStoredThemePreference();
    const applyStoredTheme = () => applyThemePreference(theme);

    applyStoredTheme();

    if (theme !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyStoredTheme);
    return () => mediaQuery.removeEventListener("change", applyStoredTheme);
  }, []);

  useEffect(() => {
    syncCurrentSubmissionPeriod();
    const intervalId = window.setInterval(syncCurrentSubmissionPeriod, 60_000);

    return () => window.clearInterval(intervalId);
  }, [syncCurrentSubmissionPeriod]);

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
