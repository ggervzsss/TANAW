import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Check, CircleAlert, Info, LoaderCircle, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import toast, { resolveValue, useToaster, type DefaultToastOptions, type Toast } from "react-hot-toast/headless";
import { routes } from "@/app/routers/routes";
import { AuthSessionManager } from "@/app/session/AuthSessionManager";
import { useAuthStore } from "@/app/store/authStore";
import { TOAST_DURATION_MS } from "@/shared/config/app.config";
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

  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionManager />
      <RealtimeProvider authenticated={authenticated} token={token} onUnauthorized={markAnonymous}>
        <SystemDisplayPreferencesProvider authenticated={authenticated} accountId={accountId}>
          {children}
          <TanawToaster />
        </SystemDisplayPreferencesProvider>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}

const TOAST_GUTTER_PX = 10;

/**
 * Toasts under the topbar (styles/components.css). Each toast rides in its own slot, placed by the
 * measured heights of the toasts above it, so a new toast pushes the others down and a leaving one
 * lets them glide back up. Resting the pointer on a toast pauses every timer.
 */
function TanawToaster() {
  const { pathname } = useLocation();
  const { toasts, handlers } = useToaster(tanawToastOptions);
  const [paused, setPaused] = useState(false);
  const hasPortalTopbar = portalRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const containerClassName = hasPortalTopbar ? "tanaw-toast-viewport tanaw-toast-viewport--portal" : "tanaw-toast-viewport tanaw-toast-viewport--auth";

  const pause = () => {
    setPaused(true);
    handlers.startPause();
  };
  const resume = () => {
    setPaused(false);
    handlers.endPause();
  };

  return (
    <div data-rht-toaster="" data-paused={paused || undefined} className={containerClassName} style={hasPortalTopbar ? portalToastContainerStyle : authToastContainerStyle}>
      {toasts.map((item) => (
        <TanawToast
          key={item.id}
          toast={item}
          offset={handlers.calculateOffset(item, { reverseOrder: false, gutter: TOAST_GUTTER_PX })}
          onHeight={handlers.updateHeight}
          onPause={pause}
          onResume={resume}
        />
      ))}
    </div>
  );
}

type TanawToastProps = {
  toast: Toast;
  offset: number;
  onHeight: (toastId: string, height: number) => void;
  onPause: () => void;
  onResume: () => void;
};

function TanawToast({ toast: item, offset, onHeight, onPause, onResume }: TanawToastProps) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    const measure = () => onHeight(item.id, slot.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [item.id, onHeight]);

  const className = [item.className ?? "tanaw-toast", item.visible ? "" : "tanaw-toast--leaving"].filter(Boolean).join(" ");

  return (
    <div ref={slotRef} className="tanaw-toast-slot" style={{ translate: `0 ${offset}px` }}>
      <div className={className} style={item.style} onMouseEnter={onPause} onMouseLeave={onResume}>
        <span className="tanaw-toast__icon" aria-hidden="true">
          {resolveToastIcon(item)}
        </span>
        <div className="tanaw-toast__message" {...item.ariaProps}>
          {resolveValue(item.message, item)}
        </div>
        <button type="button" className="tanaw-toast__dismiss" aria-label="Dismiss notification" disabled={!item.visible} onClick={() => toast.dismiss(item.id)}>
          <X size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function resolveToastIcon(item: Toast): ReactNode {
  if (item.icon) return item.icon;
  if (item.type === "success") return <Check strokeWidth={2.6} />;
  if (item.type === "error") return <CircleAlert strokeWidth={2.2} />;
  if (item.type === "loading") return <LoaderCircle className="animate-spin" strokeWidth={2.2} />;
  return <Info strokeWidth={2.2} />;
}
