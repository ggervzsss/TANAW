import { useEffect } from "react";
import { createHashRouter, RouterProvider, useBlocker } from "react-router-dom";
import { AppProviders } from "./app/providers/AppProviders";
import { AppRouter } from "./app/router/AppRouter";
import { observeThemePreference } from "./features/security/utils/theme";
import { hasSettingsDraft } from "./ui-kit/lib/settingsDraft";
import { SettingsDiscardDialog } from "./ui-kit/patterns/SettingsDiscardDialog";
import { useAuthStore } from "./features/login/stores/auth-store";

function SettingsNavigationGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && useAuthStore.getState().isAuthenticated && hasSettingsDraft());
  return blocker.state === "blocked" ? <SettingsDiscardDialog onKeepEditing={blocker.reset} onDiscard={blocker.proceed} /> : null;
}

const router = createHashRouter([
  {
    path: "*",
    element: (
      <AppProviders>
        <AppRouter />
        <SettingsNavigationGuard />
      </AppProviders>
    ),
  },
]);

export default function App() {
  useEffect(observeThemePreference, []);

  return <RouterProvider router={router} />;
}
