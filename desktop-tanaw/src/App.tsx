import { useEffect } from "react";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router/AppRouter";
import { observeThemePreference } from "./features/security/utils/theme";

export default function App() {
  useEffect(observeThemePreference, []);

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
