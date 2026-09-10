import type { CSSProperties, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { CircleAlert, CircleCheckBig, LoaderCircle } from "lucide-react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { resolveValue, useToaster, type DefaultToastOptions, type Toast } from "react-hot-toast/headless";
import { routes } from "@/app/routers/routes";
import { AuthSessionManager } from "@/app/session/AuthSessionManager";
import { useAuthStore } from "@/app/store/authStore";
import { useHeaderStore } from "@/app/store/headerStore";
import { TOAST_DURATION_MS } from "@/shared/config/app.config";
import { PageHeaderProvider } from "@/shared/components/layout";
import { queryClient } from "@/shared/lib/queryClient";
import { SystemDisplayPreferencesProvider } from "@/shared/providers/SystemDisplayPreferencesProvider";
import { RealtimeProvider } from "@/shared/realtime/RealtimeProvider";

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
  const authenticated = useAuthStore((state) => state.status === "authenticated");
  const token = useAuthStore((state) => state.token);
  const accountId = useAuthStore((state) => state.user?.id);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);
  const setHeader = useHeaderStore((state) => state.setHeader);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthSessionManager />
        <RealtimeProvider authenticated={authenticated} token={token} onUnauthorized={markAnonymous}>
          <SystemDisplayPreferencesProvider authenticated={authenticated} accountId={accountId}>
            <PageHeaderProvider setHeader={setHeader}>
              {children}
              <TanawToaster />
            </PageHeaderProvider>
          </SystemDisplayPreferencesProvider>
        </RealtimeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function TanawToaster() {
  const { pathname } = useLocation();
  const { toasts, handlers } = useToaster(tanawToastOptions);
  const hasPortalTopbar = portalRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const containerClassName = hasPortalTopbar ? "tanaw-toast-viewport tanaw-toast-viewport--portal" : "tanaw-toast-viewport tanaw-toast-viewport--auth";

  return (
    <div
      data-rht-toaster=""
      className={containerClassName}
      style={hasPortalTopbar ? portalToastContainerStyle : authToastContainerStyle}
      onMouseEnter={handlers.startPause}
      onMouseLeave={handlers.endPause}
    >
      {toasts.map((toast) => (
        <TanawToast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function TanawToast({ toast }: { toast: Toast }) {
  const className = [toast.className ?? "tanaw-toast", toast.visible ? "" : "tanaw-toast--leaving"].filter(Boolean).join(" ");

  return (
    <div className={className} style={toast.style} {...toast.ariaProps}>
      <span className="tanaw-toast__icon" aria-hidden="true">
        {resolveToastIcon(toast)}
      </span>
      <div className="tanaw-toast__message">{resolveValue(toast.message, toast)}</div>
    </div>
  );
}

function resolveToastIcon(toast: Toast): ReactNode {
  if (toast.icon) return toast.icon;
  if (toast.type === "success") return <CircleCheckBig className="h-5 w-5" />;
  if (toast.type === "error") return <CircleAlert className="h-5 w-5" />;
  if (toast.type === "loading") return <LoaderCircle className="h-5 w-5 animate-spin" />;
  return null;
}
