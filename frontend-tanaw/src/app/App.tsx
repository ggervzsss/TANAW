import { MotionConfig } from "motion/react";
import { createBrowserRouter, RouterProvider, useBlocker } from "react-router-dom";
import { hasSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { SettingsDiscardDialog } from "@/shared/ui-kit/patterns/SettingsDiscardDialog";
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
  // Movement follows the person's reduced-motion setting everywhere; state changes still show.
  return (
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  );
}

export default App;
