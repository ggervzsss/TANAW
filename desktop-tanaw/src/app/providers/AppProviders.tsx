import { QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, CircleX, Info, X } from "lucide-react";
import type { CSSProperties, PropsWithChildren } from "react";
import toast, { ToastBar, Toaster } from "react-hot-toast";
import { HashRouter, useLocation } from "react-router-dom";
import { queryClient } from "../../lib/queryClient";
import { routePaths } from "../router/routePaths";
import { AuthSessionManager } from "../../features/login/components/AuthSessionManager";
import { SystemDisplayPreferencesProvider } from "../../features/preferences/SystemDisplayPreferencesProvider";
import { RealtimeProvider } from "../../features/realtime/RealtimeProvider";
import { PersistentIssueProvider } from "../../features/toasts/components/PersistentIssueProvider";

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
    >
      {(item) => {
        const Icon = item.type === "success" ? CircleCheck : item.type === "error" ? CircleX : item.className?.includes("tanaw-toast--warning") ? AlertTriangle : Info;
        return (
          <ToastBar toast={item}>
            {({ message }) => (
              <>
                <Icon className="tanaw-toast__icon" size={20} aria-hidden="true" />
                {message}
                <button type="button" className="tanaw-toast__dismiss" aria-label="Dismiss notification" disabled={!item.visible} onClick={() => toast.dismiss(item.id)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </>
            )}
          </ToastBar>
        );
      }}
    </Toaster>
  );
}
