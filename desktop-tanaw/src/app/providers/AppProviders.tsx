import { QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties, PropsWithChildren } from "react";
import { Toaster, type DefaultToastOptions } from "react-hot-toast";
import { HashRouter, useLocation } from "react-router-dom";
import { queryClient } from "../../lib/queryClient";
import { routePaths } from "../router/routePaths";
import { AuthSessionManager } from "../../features/login/components/AuthSessionManager";
import { SystemDisplayPreferencesProvider } from "../../features/preferences/SystemDisplayPreferencesProvider";
import { RealtimeProvider } from "../../features/realtime/RealtimeProvider";
import { PersistentIssueProvider } from "../../features/toasts/components/PersistentIssueProvider";

const TOAST_DURATION_MS = 3200;

const portalToastContainerStyle: CSSProperties = {
  top: "calc(var(--tanaw-topbar-height) + clamp(12px, 2svh, 16px))",
  left: "max(16px, env(safe-area-inset-left))",
  right: "max(16px, env(safe-area-inset-right))",
};

const authToastContainerStyle: CSSProperties = {
  top: "clamp(16px, 3svh, 28px)",
  left: "max(16px, env(safe-area-inset-left))",
  right: "max(16px, env(safe-area-inset-right))",
};

const tanawToastOptions = {
  duration: TOAST_DURATION_MS,
  className: "tanaw-toast",
  success: {
    className: "tanaw-toast tanaw-toast--success",
    iconTheme: {
      primary: "#16a34a",
      secondary: "#ffffff",
    },
  },
  error: {
    className: "tanaw-toast tanaw-toast--error",
    iconTheme: {
      primary: "#a40e0e",
      secondary: "#ffffff",
    },
  },
} satisfies DefaultToastOptions;

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthSessionManager />
        <PersistentIssueProvider>
          <RealtimeProvider>
            <SystemDisplayPreferencesProvider>
              {children}
              <TanawToaster />
            </SystemDisplayPreferencesProvider>
          </RealtimeProvider>
        </PersistentIssueProvider>
      </HashRouter>
    </QueryClientProvider>
  );
}

function TanawToaster() {
  const { pathname } = useLocation();
  const hasEnterpriseTopbar = pathname === routePaths.enterprise || pathname.startsWith(`${routePaths.enterprise}/`);
  const containerClassName = hasEnterpriseTopbar ? "tanaw-toast-viewport tanaw-toast-viewport--portal" : "tanaw-toast-viewport tanaw-toast-viewport--auth";

  return (
    <Toaster
      position="top-center"
      gutter={10}
      containerClassName={containerClassName}
      containerStyle={hasEnterpriseTopbar ? portalToastContainerStyle : authToastContainerStyle}
      toastOptions={tanawToastOptions}
    />
  );
}
