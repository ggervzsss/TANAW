import { createBrowserRouter, RouterProvider, useBlocker } from "react-router-dom";
import { hasSettingsDraft } from "@/design-system/lib/settingsDraft";
import { SettingsDiscardDialog } from "@/design-system/patterns/SettingsDiscardDialog";
import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./routers/AppRouter";
import { useAuthStore } from "./store/authStore";

function SettingsNavigationGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && useAuthStore.getState().status === "authenticated" && hasSettingsDraft());
  return blocker.state === "blocked" ? <SettingsDiscardDialog onKeepEditing={blocker.reset} onDiscard={blocker.proceed} /> : null;
}

const router = createBrowserRouter([
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

function App() {
  return <RouterProvider router={router} />;
}

export default App;
