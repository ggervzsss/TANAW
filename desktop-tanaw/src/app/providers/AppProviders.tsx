import { QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleAlert, Info, LoaderCircle, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type PropsWithChildren, type ReactNode } from "react";
import toast, { resolveValue, useToaster, type Toast } from "react-hot-toast";
import { useLocation } from "react-router-dom";
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
      <AuthSessionManager />
      <PersistentIssueProvider>
        <RealtimeProvider>
          <SystemDisplayPreferencesProvider>
            {children}
            <TanawToaster />
          </SystemDisplayPreferencesProvider>
        </RealtimeProvider>
      </PersistentIssueProvider>
    </QueryClientProvider>
  );
}

const TOAST_GUTTER_PX = 10;

/**
 * Toasts under the topbar (index.css). Each toast rides in its own slot, placed by the measured
 * heights of the toasts above it, so a new toast pushes the others down and a leaving one lets them
 * glide back up. Resting the pointer on a toast pauses every timer.
 */
function TanawToaster() {
  const { pathname } = useLocation();
  const { toasts, handlers } = useToaster();
  const [paused, setPaused] = useState(false);
  const hasEnterpriseTopbar = pathname === routePaths.enterprise || pathname.startsWith(`${routePaths.enterprise}/`);
  const containerClassName = hasEnterpriseTopbar ? "tanaw-toast-viewport tanaw-toast-viewport--portal" : "tanaw-toast-viewport tanaw-toast-viewport--auth";

  const pause = () => {
    setPaused(true);
    handlers.startPause();
  };
  const resume = () => {
    setPaused(false);
    handlers.endPause();
  };

  return (
    <div data-rht-toaster="" data-paused={paused || undefined} className={containerClassName} style={hasEnterpriseTopbar ? portalToastContainerStyle : authToastContainerStyle}>
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
  if (item.className?.includes("tanaw-toast--warning")) return <AlertTriangle strokeWidth={2.2} />;
  return <Info strokeWidth={2.2} />;
}
