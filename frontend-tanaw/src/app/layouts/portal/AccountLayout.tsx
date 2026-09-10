import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { scheduleAuthorizedRoutePreload } from "@/app/routers/routeModules";
import { useAuthStore } from "@/app/store/authStore";
import { useHeaderStore } from "@/app/store/headerStore";
import { currentUserQueryKey, getCurrentUser } from "@/shared/services/accountService";
import type { UserRole } from "@/shared/types/role.types";
import { createPageStateKey, readPageState, writePageState } from "@/shared/utils/pageState";
import { PortalTopbar } from "./PortalTopbar";

type AccountLayoutProps = {
  role: UserRole;
};

const centeredTitleClassByPath = new Map<string, string>([
  [routes.it.profile, "mx-auto w-full max-w-5xl"],
  [routes.it.security, "mx-auto w-full max-w-5xl"],
  [routes.admin.profile, "mx-auto w-full max-w-5xl"],
  [routes.admin.security, "mx-auto w-full max-w-5xl"],
  [routes.staff.profile, "mx-auto w-full max-w-5xl"],
  [routes.staff.security, "mx-auto w-full max-w-5xl"],
  [routes.it.systemSettings, "mx-auto w-full max-w-6xl"],
  [routes.it.displayPreferences, "mx-auto w-full max-w-5xl"],
  [routes.admin.displayPreferences, "mx-auto w-full max-w-5xl"],
  [routes.staff.displayPreferences, "mx-auto w-full max-w-5xl"],
  [routes.it.help, "mx-auto w-full max-w-6xl"],
  [routes.admin.help, "mx-auto w-full max-w-6xl"],
  [routes.staff.help, "mx-auto w-full max-w-6xl"],
]);

export function AccountLayout({ role }: AccountLayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const typedBufferRef = useRef("");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const title = useHeaderStore((state) => state.title);
  const [isDevLogUnlocked, setIsDevLogUnlocked] = useState(false);
  const isMapView = pathname === routes.admin.mapview;
  const centeredTitleClassName = centeredTitleClassByPath.get(pathname) ?? "";
  const titleClassName = ["text-tanaw-navy mb-5 shrink-0 text-2xl font-bold tracking-tight max-sm:mb-4 max-sm:text-xl", centeredTitleClassName].filter(Boolean).join(" ");
  const sectionClassName = [
    "text-charcoal-800 flex h-screen w-full overflow-hidden bg-[#f8f9fa] font-['Bai_Jamjuree'] transition-colors duration-200 dark:bg-(--tanaw-page-bg) dark:text-slate-100",
    isMapView ? "" : "max-[920px]:h-auto max-[920px]:min-h-screen max-[920px]:flex-col max-[920px]:overflow-visible",
  ]
    .filter(Boolean)
    .join(" ");
  const mainClassName = [
    "it-portal-main flex-1 bg-[#f8f9fa] text-[15px] transition-colors duration-200 dark:bg-(--tanaw-page-bg)",
    isMapView ? "min-h-0 overflow-hidden p-0" : "overflow-y-auto px-8 py-8 max-2xl:px-7 max-xl:px-6 max-sm:px-4 max-sm:py-5",
  ]
    .filter(Boolean)
    .join(" ");
  const mainContentClassName = isMapView ? "flex h-full min-h-0 w-full flex-col" : "mx-auto w-full max-w-470";
  const scrollStateKey = useMemo(() => createPageStateKey({ portal: "web", role: user?.role ?? role, userId: user?.id ?? "anonymous" }, pathname, "scroll"), [pathname, role, user?.id, user?.role]);

  const currentUserQuery = useQuery({
    queryKey: [...currentUserQueryKey, token],
    queryFn: getCurrentUser,
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (currentUserQuery.data) {
      updateUser(currentUserQuery.data);
    }
  }, [currentUserQuery.data, updateUser]);

  useEffect(() => scheduleAuthorizedRoutePreload(role, pathname), [pathname, role]);

  useEffect(() => {
    if (currentUserQuery.isError) {
      logout();
      navigate(routes.login, { replace: true });
    }
  }, [currentUserQuery.isError, logout, navigate]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    const restored = readPageState(scrollStateKey, 1, isScrollPosition) ?? { mainTop: 0, windowTop: 0 };
    const restore = () => {
      main?.scrollTo({ top: restored.mainTop, left: 0 });
      window.scrollTo({ top: restored.windowTop, left: 0 });
    };
    const frame = window.requestAnimationFrame(restore);
    const settledRestore = window.setTimeout(restore, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settledRestore);
      writePageState(scrollStateKey, 1, {
        mainTop: main?.scrollTop ?? 0,
        windowTop: window.scrollY,
      });
    };
  }, [scrollStateKey]);

  useEffect(() => {
    typedBufferRef.current = "";
    if (pathname !== routes.it.devLog) {
      const resetDevLogUnlock = window.setTimeout(() => setIsDevLogUnlocked(false), 0);
      return () => window.clearTimeout(resetDevLogUnlock);
    }
    return undefined;
  }, [pathname]);

  useEffect(() => {
    if (role !== "it" || import.meta.env.PROD) return undefined;

    const unlockPhrase = "devlog";
    const handleDevLogShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const nextBuffer = `${typedBufferRef.current}${event.key.toLowerCase()}`.slice(-unlockPhrase.length);
      typedBufferRef.current = nextBuffer;

      if (nextBuffer === unlockPhrase) {
        setIsDevLogUnlocked(true);
        typedBufferRef.current = "";
        navigate(routes.it.devLog);
      }
    };

    window.addEventListener("keydown", handleDevLogShortcut);
    return () => window.removeEventListener("keydown", handleDevLogShortcut);
  }, [navigate, role]);

  return (
    <section className={sectionClassName}>
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <PortalTopbar role={role} showDevLog={!import.meta.env.PROD && isDevLogUnlocked} />
        <main ref={mainRef} data-density-adjustable={!isMapView} className={mainClassName}>
          <div className={mainContentClassName}>
            {title && !isMapView && <h1 className={titleClassName}>{title}</h1>}
            {pathname === routes.it.devLog && (import.meta.env.PROD || !isDevLogUnlocked) ? (
              <Navigate to={routes.it.dashboard} replace />
            ) : (
              <Suspense fallback={<DestinationShellFallback />}>
                <Outlet />
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </section>
  );
}

function DestinationShellFallback() {
  return (
    <div
      className="grid min-h-64 place-items-center rounded-2xl border border-slate-200/70 bg-white/70 text-sm font-semibold text-emerald-800 shadow-sm dark:border-white/8 dark:bg-white/3 dark:text-emerald-200"
      role="status"
    >
      Preparing workspace...
    </div>
  );
}

function isScrollPosition(value: unknown): value is { mainTop: number; windowTop: number } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "mainTop" in value &&
    "windowTop" in value &&
    typeof value.mainTop === "number" &&
    typeof value.windowTop === "number" &&
    Number.isFinite(value.mainTop) &&
    Number.isFinite(value.windowTop),
  );
}
