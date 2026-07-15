import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useHeaderStore } from "@/app/store/headerStore";
import { getCurrentUser } from "../../services/accountManagement";
import type { UserRole } from "../../types/role.types";
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
]);

export function AccountLayout({ role }: AccountLayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const title = useHeaderStore((state) => state.title);
  const isMapView = pathname === routes.admin.mapview;
  const centeredTitleClassName = centeredTitleClassByPath.get(pathname) ?? "";
  const titleClassName = [
    "text-tanaw-navy mb-5 shrink-0 text-2xl font-bold tracking-tight max-sm:mb-4 max-sm:text-xl",
    centeredTitleClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const sectionClassName = [
    "text-charcoal-800 flex h-screen w-full overflow-hidden bg-[#f8f9fa] font-['Bai_Jamjuree'] transition-colors duration-200 dark:bg-[#0b1120] dark:text-slate-100",
    isMapView ? "" : "max-[920px]:h-auto max-[920px]:min-h-screen max-[920px]:flex-col max-[920px]:overflow-visible",
  ]
    .filter(Boolean)
    .join(" ");
  const mainClassName = [
    "it-portal-main flex-1 bg-[#f8f9fa] text-[15px] transition-colors duration-200 dark:bg-[#0f172a]",
    isMapView ? "min-h-0 overflow-hidden p-0" : "overflow-y-auto px-8 py-8 max-2xl:px-7 max-xl:px-6 max-sm:px-4 max-sm:py-5",
  ]
    .filter(Boolean)
    .join(" ");
  const mainContentClassName = isMapView ? "flex h-full min-h-0 w-full flex-col" : "mx-auto w-full max-w-470";

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
    return undefined;
  }, [pathname]);

  return (
    <section className={sectionClassName}>
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <PortalTopbar role={role} />
        <main ref={mainRef} className={mainClassName}>
          <div className={mainContentClassName}>
            {title && !isMapView && <h1 className={titleClassName}>{title}</h1>}
            <Outlet />
          </div>
        </main>
      </div>
    </section>
  );
}
