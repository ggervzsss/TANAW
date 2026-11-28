import { Menu, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import toast from "react-hot-toast/headless";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { routes } from "@/app/routers/routes";
import { logoutSession } from "@/shared/services/sessionService";
import { TANAW_LOGO } from "@/shared/constants/branding";
import { roleAccessLabel, rolePortalLabel } from "@/shared/constants/roleLabels";
import { AlertsButton, useCameraAlertToasts } from "@/features/live-alerts";
import { PortalNotificationDropdown, usePortalNotifications } from "@/features/notifications/portal";
import { getRoleHelpPath, getRoleSettingsPath, isRoleSettingsPath } from "@/app/routers/roleRoutes";
import type { UserRole } from "@/shared/types/role.types";
import { getPortalTopbarThemeClasses } from "./portalTopbarTheme";
import { publishSessionEvent } from "@/shared/utils/sessionSync";
import { TopbarAccount } from "@/shared/ui-kit/patterns/TopbarAccount";
import type { ResolvedTheme, ThemePreference } from "@/shared/utils/theme";
import { DesktopPortalNavigation, PortalNavigationSheet } from "./PortalNavigation";
import { useNavigationBadges } from "./hooks/useNavigationBadges";
import { getPortalNavigation, getTopbarEntries } from "./portalNavigationModel";
import "./portal-topbar-glass.css";

/** The edge highlights follow the pointer through a CSS variable, without re-rendering. */
function followPointer(event: ReactPointerEvent<HTMLDivElement>) {
  const bar = event.currentTarget;
  bar.style.setProperty("--topbar-edge-x", `${event.clientX - bar.getBoundingClientRect().left}px`);
}

type PortalTopbarProps = {
  role: UserRole;
  showDevLog?: boolean;
  resolvedTheme: ResolvedTheme;
  /** The chosen theme and how to change it, for the theme switch in the phone menu. */
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
};

export function PortalBrand({ role }: { role: UserRole }) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="flex items-center gap-4 max-sm:min-h-11 max-sm:gap-2.5">
        <img src={TANAW_LOGO} alt="" className="size-12 shrink-0 rounded-full bg-white object-cover shadow-[0_0_0_2px_rgb(255_255_255/0.35),0_8px_20px_rgb(0_0_0/0.24)] max-sm:size-9" />
        <span className="font-display text-2xl font-bold tracking-wide drop-shadow-sm max-sm:text-xl">TANAW</span>
      </div>
      <span className="h-9 w-px bg-white/18 max-sm:hidden" aria-hidden="true" />
      <span data-portal-role-label className="text-[11px] font-semibold tracking-[0.28em] text-emerald-100/90 uppercase max-sm:hidden">
        {rolePortalLabel[role]}
      </span>
    </div>
  );
}

export function PortalTopbar({ role, resolvedTheme, theme = "system", onThemeChange, showDevLog = false }: PortalTopbarProps) {
  const authUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const { pathname, search, hash, state } = useLocation();
  const queryClient = useQueryClient();
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [menuPathname, setMenuPathname] = useState(pathname);
  const menuSheetId = useId();
  // Any change of page (a link, a notification, Back) closes the menu.
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setShowMobileNav(false);
  }
  const [showNotifications, setShowNotifications] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const { isLoading: isLoadingNotifications, markAllAsRead, markAsRead, notifications, unreadCount, viewAllPath } = usePortalNotifications(role);
  // The Admin hears about a camera that stops counting while signed in, beside the alerts button.
  useCameraAlertToasts({ enabled: role === "admin", dashboardPath: routes.admin.dashboard });

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

  // Widening the window to the desktop topbar puts the links back in the bar.
  useEffect(() => {
    if (!showMobileNav) return undefined;
    const desktop = window.matchMedia("(min-width: 80rem)");
    const close = () => {
      if (desktop.matches) setShowMobileNav(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, [showMobileNav]);

  const navigation = useMemo(() => getPortalNavigation(role, showDevLog), [role, showDevLog]);
  const topbarItems = useMemo(() => getTopbarEntries(role, navigation), [navigation, role]);
  const navigationBadges = useNavigationBadges(role);

  const isDarkTopbar = resolvedTheme === "dark";
  const topbarThemeClasses = getPortalTopbarThemeClasses(resolvedTheme);
  const topbarIconButton = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 text-white/88 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 text-white hover:bg-white/[0.14]";
  const settingsPath = getRoleSettingsPath(role);
  const helpPath = getRoleHelpPath(role);
  const inSettings = isRoleSettingsPath(role, pathname);
  const accountIdentity = { name: authUser?.displayName ?? "TANAW User", email: authUser?.email, image: authUser?.displayImageDataUrl, role: roleAccessLabel[role] };
  const activeAction = inSettings ? "settings" : pathname === helpPath || pathname.startsWith(helpPath + "/") ? "help" : undefined;
  const openSettings = (profile = false) => {
    navigate(profile ? settingsPath + "/profile" : settingsPath, {
      state: inSettings ? state : { returnTo: pathname + search + hash },
    });
  };

  return (
    <div className="sticky top-0 z-1000 w-full text-white">
      <div data-topbar-theme={resolvedTheme} className={`portal-topbar relative overflow-visible pt-[env(safe-area-inset-top)] ${topbarThemeClasses.frame}`} onPointerMove={followPointer}>
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
          className={`portal-topbar__overlay pointer-events-none absolute inset-0 ${isDarkTopbar ? "bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.055),transparent_34%),radial-gradient(circle_at_top_right,rgba(52,211,153,0.08),transparent_44%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(69,165,73,0.2),transparent_42%)]"}`}
        />
        <div className="portal-topbar__edge portal-topbar__edge--top" aria-hidden="true" />
        <div className="portal-topbar__edge portal-topbar__edge--bottom" aria-hidden="true" />

        <div
          className={`relative z-10 flex h-22 items-center gap-5 px-8 max-2xl:gap-4 max-xl:px-6 max-sm:h-16 max-sm:gap-2 max-sm:pr-[max(1rem,env(safe-area-inset-right))] max-sm:pl-[max(1rem,env(safe-area-inset-left))]${role === "admin" ? "xl:max-[1340px]:gap-3 xl:max-[1340px]:px-5" : ""}`}
        >
          <PortalBrand role={role} />

          <span className="hidden h-9 w-px shrink-0 bg-white/16 xl:block" />

          <div ref={navMenuRef} className="hidden xl:block">
            <DesktopPortalNavigation entries={topbarItems} isDark={isDarkTopbar} openMenuId={openMenuId} pathname={pathname} role={role} onMenuChange={setOpenMenuId} badges={navigationBadges} />
          </div>

          <div className="relative ml-auto flex shrink-0 items-center gap-2 max-sm:gap-1">
            {role === "admin" && (
              <AlertsButton dashboardPath={routes.admin.dashboard} className={"tanaw-topbar-compact-control " + topbarIconButton} />
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

            {/* On phones the account lives at the foot of the menu sheet. */}
            <div className="max-sm:hidden">
              <TopbarAccount
                account={accountIdentity}
                activeAction={activeAction}
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

            {/* Below the desktop breakpoint the pages open from here, at the thumb's side of the bar. */}
            <button
              type="button"
              aria-label={showMobileNav ? "Close navigation" : "Open navigation"}
              aria-expanded={showMobileNav}
              aria-haspopup="dialog"
              aria-controls={showMobileNav ? menuSheetId : undefined}
              onClick={() => {
                setShowNotifications(false);
                setOpenMenuId(null);
                setShowMobileNav((current) => !current);
              }}
              className={`tanaw-topbar-compact-control flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg xl:hidden ${topbarIconButton}`}
            >
              {showMobileNav ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showMobileNav && (
          <PortalNavigationSheet
            id={menuSheetId}
            entries={topbarItems}
            pathname={pathname}
            role={role}
            badges={navigationBadges}
            onClose={() => setShowMobileNav(false)}
            account={{
              identity: accountIdentity,
              activeAction,
              theme,
              onTheme: (next) => onThemeChange?.(next),
              onEditProfile: () => openSettings(true),
              onSettings: () => openSettings(),
              onHelp: () => navigate(helpPath),
              onSignOut: handleLogout,
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
