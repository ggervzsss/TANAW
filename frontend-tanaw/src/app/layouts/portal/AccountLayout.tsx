import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { isRoleSettingsPath } from "@/app/routers/roleRoutes";
import { scheduleAuthorizedRoutePreload } from "@/app/routers/routeModules";
import { useAuthStore } from "@/app/store/authStore";
import { PageHeaderProvider } from "@/shared/components/layout";
import { currentUserQueryKey, getCurrentUser } from "@/shared/services/accountService";
import type { UserRole } from "@/shared/types/role.types";
import { createPageStateKey, readPageState, writePageState } from "@/shared/utils/pageState";
import { PortalTopbar } from "./PortalTopbar";
import { usePortalThemePreference } from "./hooks/usePortalThemePreference";

type AccountLayoutProps = {
  role: UserRole;
};

const centeredTitleClassByPath = new Map<string, string>([
  [routes.it.help, "mx-auto w-full max-w-6xl"],
  [routes.admin.help, "mx-auto w-full max-w-6xl"],
  [routes.staff.help, "mx-auto w-full max-w-6xl"],
]);

export function AccountLayout({ role }: AccountLayoutProps) {
  const theme = usePortalThemePreference();
  const mainRef = useRef<HTMLElement>(null);
  const typedBufferRef = useRef("");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [pageHeader, setPageHeader] = useState<{ pathname: string; title: string } | null>(null);
  const registerPageHeader = useCallback(
    (title: string) => {
      const header = { pathname, title };
      setPageHeader(header);
      return () => setPageHeader((current) => (current === header ? null : current));
    },
    [pathname],
  );
  const [isDevLogUnlocked, setIsDevLogUnlocked] = useState(false);
  const isSettings = isRoleSettingsPath(role, pathname);
  const title = pageHeader?.pathname === pathname ? pageHeader.title : undefined;
  const centeredTitleClassName = centeredTitleClassByPath.get(pathname) ?? "";
  const titleClassName = ["text-(--tanaw-text) mb-5 shrink-0 text-2xl font-bold tracking-tight max-sm:mb-4 max-sm:text-xl", centeredTitleClassName].filter(Boolean).join(" ");
  const sectionClassName =
    "text-(--tanaw-text) flex h-screen w-full overflow-hidden bg-(--tanaw-page-bg) transition-colors duration-200 dark:bg-(--tanaw-page-bg) dark:text-slate-100 max-[920px]:h-auto max-[920px]:min-h-screen max-[920px]:flex-col max-[920px]:overflow-visible";
  const mainClassName =
    "it-portal-main flex-1 overflow-y-auto bg-(--tanaw-page) px-8 py-8 text-[15px] transition-colors duration-200 max-2xl:px-7 max-xl:px-6 max-sm:px-4 max-sm:py-5 dark:bg-(--tanaw-page-bg)";
  const mainContentClassName = "mx-auto w-full max-w-470";
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

  const outlet = (
    <Suspense fallback={<DestinationShellFallback />}>
      <Outlet context={theme} />
    </Suspense>
  );

  return (
    <section className={sectionClassName}>
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <PortalTopbar role={role} resolvedTheme={theme.resolvedTheme} showDevLog={!import.meta.env.PROD && isDevLogUnlocked} />
        <main ref={mainRef} data-page-scroller className={isSettings ? "tanaw-settings-page overflow-auto" : mainClassName}>
          {isSettings ? (
            outlet
          ) : (
            <div className={mainContentClassName}>
              {title && <h1 className={titleClassName}>{title}</h1>}
              {pathname === routes.it.devLog && (import.meta.env.PROD || !isDevLogUnlocked) ? (
                <Navigate to={routes.it.dashboard} replace />
              ) : (
                <PageHeaderProvider setHeader={registerPageHeader}>{outlet}</PageHeaderProvider>
              )}
            </div>
          )}
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
