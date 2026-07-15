import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { CircleAlert, CircleCheckBig, LoaderCircle } from "lucide-react";
import { BrowserRouter, useLocation } from "react-router-dom";
import {
  resolveValue,
  useToaster,
  type DefaultToastOptions,
  type Toast,
} from "react-hot-toast/headless";
import { routes } from "@/app/routers/routes";
import { TOAST_DURATION_MS } from "@/shared/config/app.config";
import { CLIENT_UPGRADE_REQUIRED_EVENT, type ClientUpgradeRequiredDetail } from "@/shared/config/client-generation";
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
        <MandatoryUpgradeOverlay />
        <TanawToaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function MandatoryUpgradeOverlay() {
  const [detail, setDetail] = useState<ClientUpgradeRequiredDetail | null>(null);

  useEffect(() => {
    const handleUpgrade = (event: Event) => {
      setDetail((event as CustomEvent<ClientUpgradeRequiredDetail>).detail);
    };
    window.addEventListener(CLIENT_UPGRADE_REQUIRED_EVENT, handleUpgrade);
    return () => window.removeEventListener(CLIENT_UPGRADE_REQUIRED_EVENT, handleUpgrade);
  }, []);

  if (!detail) return null;
  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-slate-950/80 p-5 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="tanaw-upgrade-title">
      <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl dark:border-amber-400/30 dark:bg-slate-900">
        <CircleAlert className="h-10 w-10 text-amber-600" aria-hidden="true" />
        <h1 id="tanaw-upgrade-title" className="mt-4 text-xl font-black text-slate-950 dark:text-white">TANAW update required</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{detail.message}</p>
        <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">
          Required portal version: {detail.minimumClientVersion} or newer · Contract {detail.requiredContractVersion}
        </p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800">
          Load the updated portal
        </button>
      </div>
    </div>
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
  const className = [toast.className ?? "tanaw-toast", toast.visible ? "" : "tanaw-toast--leaving"]
    .filter(Boolean)
    .join(" ");

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
