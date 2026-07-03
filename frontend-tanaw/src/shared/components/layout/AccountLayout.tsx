import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useHeaderStore } from "@/app/store/headerStore";
import { getCurrentUser } from "../../services/accountManagement";
import type { UserRole } from "../../types/role.types";
import { PortalTopbar } from "./PortalTopbar";

type AccountLayoutProps = {
  role: UserRole;
};

const centeredAccountPagePaths = new Set<string>([routes.it.profile, routes.it.security, routes.admin.profile, routes.admin.security, routes.staff.profile, routes.staff.security]);

export function AccountLayout({ role }: AccountLayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const typedBufferRef = useRef("");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const title = useHeaderStore((state) => state.title);
  const [isDevLogUnlocked, setIsDevLogUnlocked] = useState(false);
  const isAccountSettingsPage = centeredAccountPagePaths.has(pathname);
  const titleClassName = [
    "text-tanaw-navy mb-5 text-2xl font-bold tracking-tight max-sm:mb-4 max-sm:text-xl",
    isAccountSettingsPage ? "mx-auto w-full max-w-5xl" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const currentUserQuery = useQuery({
    queryKey: ["current-user", token],
    queryFn: getCurrentUser,
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (currentUserQuery.data) {
      updateUser(currentUserQuery.data);
    }
  }, [currentUserQuery.data, updateUser]);

  useEffect(() => {
    if (currentUserQuery.isError) {
      logout();
      navigate(routes.login, { replace: true });
    }
  }, [currentUserQuery.isError, logout, navigate]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo({ top: 0, left: 0 });
    typedBufferRef.current = "";
    if (pathname !== routes.it.devLog) {
      const resetDevLogUnlock = window.setTimeout(() => setIsDevLogUnlocked(false), 0);
      return () => window.clearTimeout(resetDevLogUnlock);
    }
    return undefined;
  }, [pathname]);

  useEffect(() => {
    if (role !== "it") return undefined;

    const unlockPhrase = "devlog";
    const handleDevLogShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const nextBuffer = `${typedBufferRef.current}${event.key.toLowerCase()}`.slice(-unlockPhrase.length);
      typedBufferRef.current = nextBuffer;

      if (nextBuffer === unlockPhrase) {
        setIsDevLogUnlocked(true);
        typedBufferRef.current = "";
      }
    };

    window.addEventListener("keydown", handleDevLogShortcut);
    return () => window.removeEventListener("keydown", handleDevLogShortcut);
  }, [role]);

  return (
    <section className="text-charcoal-800 flex h-screen w-full overflow-hidden bg-[#f8f9fa] font-['Bai_Jamjuree'] max-[920px]:h-auto max-[920px]:min-h-screen max-[920px]:flex-col max-[920px]:overflow-visible">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <PortalTopbar role={role} showDevLog={isDevLogUnlocked} />
        <main ref={mainRef} className="it-portal-main flex-1 overflow-y-auto bg-[#f8f9fa] px-8 py-8 text-[15px] max-2xl:px-7 max-xl:px-6 max-sm:px-4 max-sm:py-5">
          <div className="mx-auto w-full max-w-470">
            {title && <h1 className={titleClassName}>{title}</h1>}
            {pathname === routes.it.devLog && !isDevLogUnlocked ? <Navigate to={routes.it.dashboard} replace /> : <Outlet />}
          </div>
        </main>
      </div>
    </section>
  );
}
