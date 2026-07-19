import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, LogOut, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ModalPortal } from "../../../components/ModalPortal";
import { queryClient } from "../../../lib/queryClient";
import { routePaths } from "../../../app/router/routePaths";
import { notifyError } from "../../toasts/services/toast-service";
import { logout as logoutRequest, restoreSession } from "../api/login";
import { useAuthStore } from "../stores/auth-store";
import { getInactivitySnapshot } from "../utils/inactivity-session";

export { INACTIVITY_COUNTDOWN_MS, INACTIVITY_WARNING_AFTER_MS } from "../utils/inactivity-session";
const ACTIVITY_RECORD_THROTTLE_MS = 1000;

export function AuthSessionManager() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const setSession = useAuthStore((state) => state.setSession);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);
  const logout = useAuthStore((state) => state.logout);
  const [warningStartedAt, setWarningStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(60);
  const lastActivityRef = useRef(0);
  const logoutInProgressRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  const clearSession = useCallback(() => {
    logout();
    queryClient.clear();
    setWarningStartedAt(null);
    navigate(routePaths.login, { replace: true });
  }, [logout, navigate]);

  const terminateSession = useCallback(
    async (reason: "expired" | "manual") => {
      if (logoutInProgressRef.current) return;
      logoutInProgressRef.current = true;
      try {
        await logoutRequest();
      } catch {
        // The encrypted local session must still be removed while offline.
      } finally {
        clearSession();
        if (reason === "expired") notifyError("Session expired after six minutes of inactivity.");
        logoutInProgressRef.current = false;
      }
    },
    [clearSession],
  );

  const recordActivity = useCallback((force = false) => {
    const occurredAt = Date.now();
    if (!force && occurredAt - lastActivityRef.current < ACTIVITY_RECORD_THROTTLE_MS) return;
    lastActivityRef.current = occurredAt;
    setWarningStartedAt(null);
    setRemainingSeconds(60);
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const stored = await window.tanawAuthSession?.load();
        const token = readStoredToken(stored);
        const session = await restoreSession(token ?? undefined);
        if (!disposed) setSession(session);
      } catch {
        await window.tanawAuthSession?.clear();
        if (!disposed) markAnonymous();
      }
    })();
    return () => {
      disposed = true;
    };
  }, [markAnonymous, setSession]);

  useEffect(() => {
    if (status !== "authenticated") {
      return undefined;
    }

    lastActivityRef.current = Date.now();
    const handleActivity = (event: Event) => {
      const isInsideWarning = event.target instanceof Element && event.target.closest("[data-session-warning-dialog]");
      if (isInsideWarning && event.type !== "pointermove") return;
      recordActivity();
    };
    const activityEvents: (keyof WindowEventMap)[] = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    const intervalId = window.setInterval(() => {
      const snapshot = getInactivitySnapshot(lastActivityRef.current, Date.now());
      if (snapshot.phase === "expired") {
        void terminateSession("expired");
        return;
      }
      if (snapshot.phase === "warning") {
        setWarningStartedAt((current) => current ?? Date.now());
        setRemainingSeconds(snapshot.remainingSeconds);
      }
    }, 250);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.clearInterval(intervalId);
    };
  }, [recordActivity, status, terminateSession]);

  useEffect(() => {
    if (warningStartedAt === null) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [warningStartedAt]);

  if (status !== "authenticated" || warningStartedAt === null) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1500 grid place-items-center bg-slate-950/75 p-4 backdrop-blur-md">
        <section
          ref={dialogRef}
          data-session-warning-dialog
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="desktop-session-warning-title"
          aria-describedby="desktop-session-warning-description"
          className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_34px_100px_rgba(0,0,0,0.5)] dark:border-slate-600 dark:bg-[#121c31]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              recordActivity(true);
              return;
            }
            if (event.key === "Tab") {
              const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className="h-1.5 bg-linear-to-r from-emerald-700 via-emerald-400 to-amber-400" />
          <div className="p-7">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/12 dark:text-amber-200 dark:ring-amber-300/20">
                <Clock3 size={23} />
              </span>
              <div>
                <h2 id="desktop-session-warning-title" className="text-xl font-bold text-slate-950 dark:text-white">
                  Session Expiring
                </h2>
                <p id="desktop-session-warning-description" className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  You will be signed out in one minute because TANAW has detected five minutes without activity.
                </p>
              </div>
            </div>
            <div className="my-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center dark:border-amber-300/20 dark:bg-amber-400/10">
              <p className="text-xs font-bold tracking-[0.14em] text-amber-800 uppercase dark:text-amber-200">Signing out in</p>
              <p className="mt-1 font-mono text-3xl font-black text-amber-950 tabular-nums dark:text-amber-100" aria-live="polite">
                {remainingSeconds}s
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void terminateSession("manual")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <LogOut size={16} /> Log Out Now
              </button>
              <button
                ref={stayButtonRef}
                type="button"
                onClick={() => recordActivity(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:ring-4 focus-visible:ring-emerald-500/25 focus-visible:outline-none"
              >
                <ShieldCheck size={16} /> Stay Signed In
              </button>
            </div>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

function readStoredToken(value: unknown) {
  if (!value || typeof value !== "object" || !("token" in value)) return null;
  const token = (value as { token?: unknown }).token;
  return typeof token === "string" && token ? token : null;
}
