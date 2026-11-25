import { Menu, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { routes } from "@/app/routers/routes";
import { logoutSession } from "@/shared/services/sessionService";
import { TANAW_LOGO } from "@/shared/constants/branding";
import { roleAccessLabel, rolePortalLabel } from "@/shared/constants/roleLabels";
import { AlertsButton } from "@/features/live-alerts";
import { PortalNotificationDropdown, usePortalNotifications } from "@/features/notifications/portal";
import { getRoleHelpPath, getRoleSettingsPath, isRoleSettingsPath } from "@/app/routers/roleRoutes";
import type { UserRole } from "@/shared/types/role.types";
import { getPortalTopbarThemeClasses } from "./portalTopbarTheme";
import { publishSessionEvent } from "@/shared/utils/sessionSync";
import { TopbarAccount } from "@/shared/ui-kit/patterns/TopbarAccount";
import type { ResolvedTheme } from "@/shared/utils/theme";
import { DesktopPortalNavigation, MobilePortalNavigation } from "./PortalNavigation";
import { getPortalNavigation, getTopbarEntries } from "./portalNavigationModel";

type PortalTopbarProps = {
  role: UserRole;
  showDevLog?: boolean;
  resolvedTheme: ResolvedTheme;
};

export function PortalBrand({ role }: { role: UserRole }) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="flex items-center gap-4 max-[360px]:gap-1.5 max-sm:min-h-11 max-sm:gap-2">
        <img src={TANAW_LOGO} alt="" className="h-10 w-14 rounded-lg object-cover max-sm:h-7 max-sm:w-10" />
        <span className="font-display text-2xl font-bold tracking-wide drop-shadow-sm max-sm:text-base">TANAW</span>
      </div>
      <span className="h-9 w-px bg-white/18 max-sm:hidden" aria-hidden="true" />
      <span data-portal-role-label className="text-[11px] font-semibold tracking-[0.28em] text-emerald-100/90 uppercase max-sm:hidden">
        {rolePortalLabel[role]}
      </span>
    </div>
  );
}

export function PortalTopbar({ role, resolvedTheme, showDevLog = false }: PortalTopbarProps) {
  const authUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const { pathname, search, hash, state } = useLocation();
  const queryClient = useQueryClient();
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const { isLoading: isLoadingNotifications, markAllAsRead, markAsRead, notifications, unreadCount, viewAllPath } = usePortalNotifications(role);

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) TANAW Portal` : "TANAW Portal";
    return () => {
      document.title = "TANAW Portal";
    };
  }, [unreadCount]);

  const handleLogout = async () => {
    try {
      await logoutSession();
    } catch {
      toast.error("Logout log was not recorded, but your local session was cleared.");
    } finally {
      queryClient.clear();
      logout();
      publishSessionEvent({ type: "logout", occurredAt: Date.now() });
      toast.success("Logout complete");
      navigate(routes.login, { replace: true });
    }
  };

  const handleNotificationSelect = (notificationId: string, targetPath?: string) => {
    markAsRead(notificationId);
    setShowNotifications(false);
    setOpenMenuId(null);
    setShowMobileNav(false);
    if (targetPath) {
      navigate(targetPath);
    }
  };

  const handleViewAllNotifications = () => {
    setShowNotifications(false);
    setOpenMenuId(null);
    setShowMobileNav(false);
    if (viewAllPath) {
      navigate(viewAllPath);
    }
  };

  useEffect(() => {
    if (!showNotifications) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [showNotifications]);

  useEffect(() => {
    if (!openMenuId) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!navMenuRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openMenuId]);

  useEffect(() => {
    if (!openMenuId && !showMobileNav && !showNotifications) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setOpenMenuId(null);
      setShowMobileNav(false);
      setShowNotifications(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openMenuId, showMobileNav, showNotifications]);

  const navigation = useMemo(() => getPortalNavigation(role, showDevLog), [role, showDevLog]);
  const topbarItems = useMemo(() => getTopbarEntries(role, navigation), [navigation, role]);

  const isDarkTopbar = resolvedTheme === "dark";
  const topbarThemeClasses = getPortalTopbarThemeClasses(resolvedTheme);
  const topbarIconButton = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 text-white/88 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 text-white hover:bg-white/[0.14]";
  const settingsPath = getRoleSettingsPath(role);
  const helpPath = getRoleHelpPath(role);
  const inSettings = isRoleSettingsPath(role, pathname);
  const openSettings = (profile = false) => {
    navigate(profile ? settingsPath + "/profile" : settingsPath, {
      state: inSettings ? state : { returnTo: pathname + search + hash },
    });
  };

  return (
    <div className="sticky top-0 z-1000 w-full text-white">
      <div data-topbar-theme={resolvedTheme} className={`relative overflow-visible ${topbarThemeClasses.frame}`}>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[58%] mask-[linear-gradient(90deg,transparent,black_22%,black)] max-lg:w-[76%]">
          <div
            data-topbar-image="day"
            className={`absolute inset-0 bg-cover bg-center mix-blend-screen transition-opacity duration-350 motion-reduce:transition-none ${topbarThemeClasses.imageTreatment} ${topbarThemeClasses.dayImage}`}
            style={{ backgroundImage: "url('/images/it-topbar-building.png')" }}
          />
          <div
            data-topbar-image="night"
            className={`absolute inset-0 bg-cover bg-center mix-blend-screen transition-opacity duration-350 motion-reduce:transition-none ${topbarThemeClasses.imageTreatment} ${topbarThemeClasses.nightImage}`}
            style={{ backgroundImage: "url('/images/it-topbar-building-night.png')" }}
          />
        </div>
        <div className={`pointer-events-none absolute inset-0 ${topbarThemeClasses.overlay}`} />
        <div
          className={`pointer-events-none absolute inset-0 ${isDarkTopbar ? "bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.055),transparent_34%),radial-gradient(circle_at_top_right,rgba(52,211,153,0.08),transparent_44%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(69,165,73,0.2),transparent_42%)]"}`}
        />
        <div data-topbar-signature className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,transparent,var(--tanaw-gold-line)_14%,var(--tanaw-gold-line)_86%,transparent)] opacity-85" />

        <div
          className={`relative z-10 flex h-22 items-center gap-5 px-8 max-2xl:gap-4 max-xl:px-6 max-sm:h-18 max-sm:gap-1 max-sm:px-2 ${role === "admin" ? "xl:max-[1340px]:gap-3 xl:max-[1340px]:px-5" : ""}`}
        >
          <PortalBrand role={role} />

          <span className="hidden h-9 w-px shrink-0 bg-white/16 xl:block" />

          <div ref={navMenuRef} className="hidden xl:block">
            <DesktopPortalNavigation entries={topbarItems} isDark={isDarkTopbar} openMenuId={openMenuId} pathname={pathname} role={role} onMenuChange={setOpenMenuId} />
          </div>

          <button
            type="button"
            aria-label={showMobileNav ? "Close navigation" : "Open navigation"}
            onClick={() => setShowMobileNav((current) => !current)}
            className={`tanaw-topbar-compact-control flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg xl:hidden ${topbarIconButton}`}
          >
            {showMobileNav ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="relative ml-auto flex shrink-0 items-center gap-2 max-sm:gap-1">
            {(role === "admin" || role === "it") && (
              <AlertsButton dashboardPath={role === "admin" ? routes.admin.dashboard : null} className={"tanaw-topbar-compact-control " + topbarIconButton} />
            )}
            {role !== "admin" && (
            <div ref={notificationMenuRef} className="sm:relative">
              <PortalNotificationDropdown
                isOpen={showNotifications}
                isLoading={isLoadingNotifications}
                notifications={notifications}
                unreadCount={unreadCount}
                viewAllPath={viewAllPath}
                onMarkAllRead={markAllAsRead}
                onSelectNotification={(notification) => handleNotificationSelect(notification.id, notification.targetPath)}
                onToggle={() => {
                  setShowNotifications((current) => !current);
                  setOpenMenuId(null);
                }}
                onViewAll={handleViewAllNotifications}
                triggerClassName={"tanaw-topbar-compact-control " + topbarIconButton}
              />
            </div>
            )}

            <TopbarAccount
              account={{ name: authUser?.displayName ?? "TANAW User", email: authUser?.email, image: authUser?.displayImageDataUrl, role: roleAccessLabel[role] }}
              activeAction={inSettings ? "settings" : pathname === helpPath || pathname.startsWith(helpPath + "/") ? "help" : undefined}
              onEditProfile={() => openSettings(true)}
              onSettings={() => openSettings()}
              onHelp={() => navigate(helpPath)}
              onSignOut={handleLogout}
              onOpen={() => {
                setShowNotifications(false);
                setOpenMenuId(null);
                setShowMobileNav(false);
              }}
            />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showMobileNav && <MobilePortalNavigation entries={topbarItems} isDark={isDarkTopbar} pathname={pathname} role={role} onNavigate={() => setShowMobileNav(false)} />}
      </AnimatePresence>
    </div>
  );
}
