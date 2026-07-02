import type { CSSProperties, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import { Toaster, type DefaultToastOptions } from "react-hot-toast";
import { routes } from "@/app/routers/routes";
import { TOAST_DURATION_MS } from "@/shared/config/app.config";
import { OperationalSyncBridge } from "@/shared/hooks/useOperationalSync";
import { queryClient } from "@/shared/lib/queryClient";

type AppProvidersProps = {
  children: ReactNode;
};

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

const portalRoutePrefixes = [routes.it.root, routes.admin.root, routes.staff.root] as const;

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OperationalSyncBridge />
        {children}
        <TanawToaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function TanawToaster() {
  const { pathname } = useLocation();
  const hasPortalTopbar = portalRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const containerClassName = hasPortalTopbar ? "tanaw-toast-viewport tanaw-toast-viewport--portal" : "tanaw-toast-viewport tanaw-toast-viewport--auth";

  return (
    <Toaster
      position="top-center"
      gutter={10}
      containerClassName={containerClassName}
      containerStyle={hasPortalTopbar ? portalToastContainerStyle : authToastContainerStyle}
      toastOptions={tanawToastOptions}
    />
  );
}
